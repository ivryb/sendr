const encoder = new TextEncoder()

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
  return toHex(new Uint8Array(digest))
}

export function timingSafeEqual(a: string, b: string) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.byteLength !== right.byteLength) return false
  return crypto.subtle.timingSafeEqual(left, right)
}

/** Signs `${purpose}:${id}` so link tokens for one purpose can't be replayed for another. */
export async function signToken(secret: string, purpose: string, id: string) {
  return `${id}.${await signature(secret, `${purpose}:${id}`)}`
}

export async function verifyToken(
  secret: string,
  purpose: string,
  token: string
) {
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const id = token.slice(0, dot)
  const expected = await signature(secret, `${purpose}:${id}`)
  return timingSafeEqual(token.slice(dot + 1), expected) ? id : null
}

async function signature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return toBase64Url(new Uint8Array(mac).slice(0, 16))
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}
