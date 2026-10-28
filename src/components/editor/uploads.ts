import { Extension, type Editor, type JSONContent } from "@tiptap/core"
import type { Node as Doc } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { toast } from "sonner"

import { api, ApiError } from "@/lib/api"
import type { Media } from "../../../shared/model"
import { uploadPlaceholder } from "./node-views"

type PlaceholderChange =
  | { add: { id: string; pos: number; order: number; dom: HTMLElement } }
  | { remove: string }

const placeholders = new PluginKey<DecorationSet>("uploads")

/** Dropped and pasted images, video and audio upload and go in where they landed. */
export const Uploads = Extension.create({
  name: "uploads",
  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        key: placeholders,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const next = set.map(tr.mapping, tr.doc)
            const change: PlaceholderChange | undefined = tr.getMeta(placeholders)
            if (change && "add" in change) {
              const { id, pos, order, dom } = change.add
              // Content inserted at a widget's position goes before it, so files keep their order.
              return next.add(tr.doc, [Decoration.widget(pos, dom, { id, side: order })])
            }
            if (change) return next.remove(next.find(undefined, undefined, (spec) => spec.id === change.remove))
            return next
          },
        },
        props: {
          decorations: (state) => placeholders.getState(state),
          handleDrop: (view, event, _slice, moved) => {
            const files = [...(event.dataTransfer?.files ?? [])]
            if (moved || !files.length) return false
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            void uploadFiles(editor, files, pos)
            return true
          },
          handlePaste: (_view, event) => {
            const files = [...(event.clipboardData?.files ?? [])]
            // Word and the like also put a picture of copied text on the clipboard.
            if (!files.length || event.clipboardData?.getData("text/plain")) return false
            void uploadFiles(editor, files)
            return true
          },
        },
      }),
    ]
  },
})

/**
 * Uploads files one at a time and puts each in at `at` as an image or a media card, with a
 * placeholder there until it's done. Other kinds of files are turned away with a toast.
 */
export async function uploadFiles(editor: Editor, files: File[], at = editor.state.selection.from) {
  const media = files.filter((file) => /^(image|video|audio)\//.test(file.type))
  for (const file of files) {
    if (!media.includes(file)) toast.error(`${file.name} isn't an image, video or audio file.`)
  }
  const pos = blockBoundary(editor.state.doc, at)
  const jobs = media.map((file, order) => {
    const id = crypto.randomUUID()
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null
    const dom = uploadPlaceholder(file, preview)
    editor.view.dispatch(editor.state.tr.setMeta(placeholders, { add: { id, pos, order, dom } }))
    return { id, file, preview }
  })

  for (const { id, file, preview } of jobs) {
    try {
      const content = await uploadContent(file)
      const here = placeholders
        .getState(editor.state)
        ?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from
      // The placeholder is gone when the text around it was deleted meanwhile.
      if (here !== undefined) {
        editor.chain().insertContentAt(here, content, { updateSelection: false }).run()
      }
    } catch (error) {
      toast.error(`Couldn't upload ${file.name}`, {
        description: error instanceof ApiError ? error.message : undefined,
      })
    } finally {
      if (preview) URL.revokeObjectURL(preview)
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta(placeholders, { remove: id }))
      }
    }
  }
}

/** Blocks go after the top-level block holding `pos`, or before it when it's an empty line. */
function blockBoundary(doc: Doc, pos: number) {
  const $pos = doc.resolve(pos)
  if ($pos.depth === 0) return pos
  const block = $pos.node(1)
  return block.isTextblock && !block.content.size ? $pos.before(1) : $pos.after(1)
}

async function uploadContent(file: File): Promise<JSONContent> {
  if (file.type.startsWith("image/")) {
    const [image, width] = await Promise.all([upload(file), imageWidth(file)])
    return { type: "image", attrs: { src: image.url, width } }
  }
  const kind = file.type.startsWith("video/") ? "video" : "audio"
  const { duration, poster } = await probe(file, kind)
  const cover = poster && (await upload(new File([poster], `${stem(file.name)}.jpg`, { type: "image/jpeg" })))
  const media = await upload(file, { poster: cover?.id, duration })
  return {
    type: "mediaCard",
    attrs: {
      kind,
      src: media.url,
      poster: media.posterUrl,
      duration: duration && formatDuration(duration),
    },
  }
}

async function upload(file: File, options: { poster?: string; duration?: number | null } = {}) {
  const query = new URLSearchParams({ name: file.name })
  if (options.poster) query.set("poster", options.poster)
  if (options.duration) query.set("duration", options.duration.toFixed(1))
  const { media } = await api<{ media: Media }>(`/api/v1/media?${query}`, { body: file })
  return media
}

/** The width the renderer gives an image, so small ones aren't stretched. */
async function imageWidth(file: File) {
  try {
    const bitmap = await createImageBitmap(file)
    const { width } = bitmap
    bitmap.close()
    return String(width)
  } catch {
    return null
  }
}

/** A file's duration, and for a video a frame from about a second in as a JPEG poster. */
async function probe(file: File, kind: "video" | "audio") {
  const url = URL.createObjectURL(file)
  const media = document.createElement(kind)
  media.muted = true
  media.preload = "auto"
  media.src = url
  try {
    await settle(media, "loadedmetadata")
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null
    if (!(media instanceof HTMLVideoElement)) return { duration, poster: null }
    media.currentTime = Math.min(1, (duration ?? 0) / 10)
    await settle(media, "seeked")
    return { duration, poster: await snapshot(media) }
  } catch {
    // A format the browser can't play still uploads, just without these.
    return { duration: null, poster: null }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function settle(media: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    media.addEventListener(event, () => resolve(), { once: true })
    media.addEventListener("error", () => reject(media.error), { once: true })
  })
}

function snapshot(video: HTMLVideoElement) {
  const scale = Math.min(1, 1280 / video.videoWidth)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const context = canvas.getContext("2d")
  if (!canvas.width || !context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
}

/** 2:14, or 1:02:14 past an hour. */
function formatDuration(seconds: number) {
  const total = Math.round(seconds)
  const pad = (value: number) => String(value).padStart(2, "0")
  const [hours, minutes] = [Math.floor(total / 3600), Math.floor(total / 60) % 60]
  return hours ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "") || name
}
