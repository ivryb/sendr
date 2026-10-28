import { describe, expect, it } from "vitest"

import { bodyToText, editorBodyToHtml, renderEmail } from "../shared/render"

const body = [
  "<h2>Hi {{first_name|there}},</h2>",
  '<p>Read the <a href="https://example.com/?ref={{first_name|x}}">changelog</a>.</p>',
  '<figure data-media="video" data-src="https://example.com/v.mp4" data-title="Walkthrough" data-duration="2:14"></figure>',
].join("")

const send = (format: "editor" | "html" | "text", text: string) =>
  renderEmail({
    subject: "October",
    format,
    body: text,
    footer: "Acme Inc.",
    recipient: { firstName: "Ann", fields: {} },
    unsubscribeUrl: "https://example.com/u/1",
  })

describe("switching formats", () => {
  it("turns an editor body into an HTML document that sends like the editor campaign", () => {
    const html = editorBodyToHtml("October", body)
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("Hi {{first_name|there}},")
    expect(html).not.toContain("Unsubscribe")

    const sent = send("html", html)
    expect(sent.html).toContain("Hi Ann,")
    expect(sent.html).toContain('href="https://example.com/v.mp4"')
    expect(sent.html).toContain("Unsubscribe")
  })

  it("turns an editor body into plain text with its merge tags and without the footer", () => {
    expect(bodyToText("editor", body)).toBe(
      [
        "Hi {{first_name|there}},",
        "Read the changelog (https://example.com/?ref={{first_name|x}}) .",
        "Walkthrough: https://example.com/v.mp4",
      ].join("\n\n")
    )
    expect(bodyToText("text", "Hi {{first_name}}")).toBe("Hi {{first_name}}")
  })
})

it("keeps a blank line from the editor in the email", () => {
  expect(send("editor", "<p>One</p><p></p><p>Two</p>").html).toContain(">&nbsp;</p>")
})
