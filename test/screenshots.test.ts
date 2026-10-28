import { beforeEach, describe, expect, it } from "vitest"

import type { Campaign } from "../shared/model"
import { createApiKey, request, signInAsAdmin } from "./helpers"

let admin: string

beforeEach(async () => {
  admin = await signInAsAdmin()
})

async function newCampaign() {
  const response = await request("/api/v1/campaigns", {
    cookie: admin,
    json: { subject: "Hello {{first_name|there}}", markdown: "# Hi\n\nSee you soon." },
  })
  return (await response.json<{ campaign: Campaign }>()).campaign
}

/** A PNG's width in pixels, from its header. */
async function pngWidth(response: Response) {
  const bytes = new DataView(await response.arrayBuffer())
  expect(bytes.getUint32(0)).toBe(0x89504e47)
  return bytes.getUint32(16)
}

describe("campaign screenshots", () => {
  it("shows light and dark side by side, or one of them", { timeout: 30_000 }, async () => {
    const { id } = await newCampaign()
    const both = await request(`/api/v1/campaigns/${id}/screenshot`, { cookie: admin })
    expect(both.status).toBe(200)
    expect(both.headers.get("content-type")).toBe("image/png")
    const light = await request(`/api/v1/campaigns/${id}/screenshot?theme=light`, { cookie: admin })
    expect(await pngWidth(both)).toBeGreaterThan(1.8 * (await pngWidth(light)))
  })

  it("refuses an unknown theme or campaign", async () => {
    const { id } = await newCampaign()
    const theme = await request(`/api/v1/campaigns/${id}/screenshot?theme=sepia`, { cookie: admin })
    expect(theme.status).toBe(400)
    const missing = await request("/api/v1/campaigns/nope/screenshot", { cookie: admin })
    expect(missing.status).toBe(404)
  })

  it("needs full access", async () => {
    const { id } = await newCampaign()
    const key = await createApiKey(admin, ["contacts", "emails"])
    const response = await request(`/api/v1/campaigns/${id}/screenshot`, { bearer: key })
    expect(response.status).toBe(403)
  })
})
