/** Stands in for Cloudflare's DNS over HTTPS: test/setup.ts routes cloudflare-dns.com here. */
export const fakeDns = {
  /** TXT records by name, as the DNS JSON API quotes them. */
  txt: {} as Record<string, string[]>,
}

export function resetFakeDns() {
  fakeDns.txt = {}
}

export function fakeDnsResponse(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? ""
  const answers = (fakeDns.txt[name] ?? []).map((data) => ({ name, type: 16, data }))
  return Response.json({ Status: answers.length ? 0 : 3, Answer: answers.length ? answers : undefined })
}
