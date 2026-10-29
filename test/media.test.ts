import { beforeEach, describe, expect, it } from "vitest"

import type { Media } from "../shared/model"
import { request, signInAsAdmin } from "./helpers"

let admin: string

beforeEach(async () => {
  admin = await signInAsAdmin()
})

const BYTES = new TextEncoder().encode("0123456789")

function upload(query: string, contentType: string, bytes = BYTES) {
  return request(`/api/v1/media?${query}`, {
    method: "POST",
    cookie: admin,
    headers: { "content-type": contentType, "content-length": String(bytes.length) },
    body: bytes,
  })
}

async function uploaded(query: string, contentType: string) {
  const response = await upload(query, contentType)
  expect(response.status).toBe(201)
  return (await response.json<{ media: Media }>()).media
}

/** The served path of a media URL; requests go to the test instance either way. */
const pathOf = (url: string) => new URL(url).pathname

describe("media", () => {
  it("an uploaded image is served back with its content type", async () => {
    const image = await uploaded("name=hero%20shot.png", "image/png")
    expect(image).toMatchObject({ kind: "image", name: "hero shot.png", size: 10 })
    expect(image.url).toMatch(/^https:\/\/sendr\.test\/media\/[\w-]+\/hero%20shot\.png$/)

    const served = await request(pathOf(image.url))
    expect(served.status).toBe(200)
    expect(served.headers.get("content-type")).toBe("image/png")
    expect(served.headers.get("accept-ranges")).toBe("bytes")
    expect(await served.text()).toBe("0123456789")
  })

  it("a range request returns 206 with the requested bytes", async () => {
    const video = await uploaded("name=clip.mp4", "video/mp4")
    const served = await request(pathOf(video.url), { headers: { range: "bytes=2-5" } })
    expect(served.status).toBe(206)
    expect(served.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(await served.text()).toBe("2345")
  })

  it("a range past the end returns 416", async () => {
    const video = await uploaded("name=clip.mp4", "video/mp4")
    const served = await request(pathOf(video.url), { headers: { range: "bytes=10-" } })
    expect(served.status).toBe(416)
    expect(served.headers.get("content-range")).toBe("bytes */10")
  })

  it("an unsupported file type is rejected", async () => {
    expect((await upload("name=notes.pdf", "application/pdf")).status).toBe(415)
    expect((await upload("name=logo.svg", "image/svg+xml")).status).toBe(415)
  })

  it("a content type smuggling a second type is rejected", async () => {
    expect((await upload("name=page.mp4", "video/mp4,text/html")).status).toBe(415)
    expect((await upload("name=logo.png", "image/png,image/svg+xml")).status).toBe(415)
    expect((await upload("name=page.png", "image/png html")).status).toBe(415)
  })

  it("media can't run as a page on the instance's origin", async () => {
    const image = await uploaded("name=hero.png", "image/png; charset=binary")
    const served = await request(pathOf(image.url))
    expect(served.headers.get("content-type")).toBe("image/png")
    expect(served.headers.get("x-content-type-options")).toBe("nosniff")
    // Without allow-same-origin, Chromium's player never loads a video or audio opened directly,
    // which is how email cards link to them. Scripts stay blocked either way.
    expect(served.headers.get("content-security-policy")).toBe("sandbox allow-same-origin")
  })

  it("a video can reference an uploaded poster", async () => {
    const poster = await uploaded("name=poster.jpg", "image/jpeg")
    const video = await uploaded(`name=demo.mp4&poster=${poster.id}&duration=134`, "video/mp4")
    expect(video).toMatchObject({ kind: "video", posterUrl: poster.url, durationSeconds: 134 })

    const notAnImage = await upload(`name=again.mp4&poster=${video.id}`, "video/mp4")
    expect(notAnImage.status).toBe(422)
  })

  it("an unknown file is not found", async () => {
    expect((await request("/media/nope/file.png")).status).toBe(404)
  })
})
