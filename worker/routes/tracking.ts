import { Hono } from "hono"

import { followClick, recordOpen } from "../domain/tracking"

// A 1x1 transparent GIF.
const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (char) => char.charCodeAt(0)
)

/** Click links (/c) and the open pixel (/o) in campaign emails. */
export const tracking = new Hono()
  .get("/c/:token", async (c) => {
    const url = await followClick(c.req.param("token"))
    return url ? c.redirect(url, 302) : c.text("This link isn't valid.", 404)
  })
  .get("/o/:token", async (c) => {
    // The image is returned whatever happens, so a broken token never shows a broken image.
    await recordOpen(c.req.param("token")).catch(console.error)
    return c.body(PIXEL, 200, {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    })
  })
