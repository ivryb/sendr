// Creates an API key directly in an instance's D1 database. Through the API only a signed-in
// admin can create keys, so this is how an agent setting Sendr up gets its own key.
//
//   bun run api-key https://emails.example.com --save
//   bun run api-key https://emails.example.com --name "Acme backend" --permissions contacts,emails
//
// Run it from the checkout the instance deploys from, with Wrangler signed in. Keys get full
// access unless --permissions says otherwise. --save writes the key to
// ~/.config/sendr/<host>.env, where agents look for Sendr instances. --local targets
// the dev server's database instead.
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { API_KEY_PERMISSIONS, type ApiKeyPermission } from "../shared/model.ts"
import { newApiKey } from "../worker/lib/crypto.ts"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string", default: `Agent on ${hostname()}` },
    permissions: { type: "string", default: "full" },
    save: { type: "boolean", default: false },
    local: { type: "boolean", default: false },
  },
})

const url = parseUrl(positionals[0])
const permissions = parsePermissions(values.permissions)
const { key, prefix, hash } = await newApiKey()

execFileSync(
  "bunx",
  [
    "wrangler",
    "d1",
    "execute",
    "DB",
    values.local ? "--local" : "--remote",
    "--yes",
    "--command",
    `INSERT INTO api_keys (id, name, permissions, prefix, hash, created_at) VALUES (${[
      crypto.randomUUID(),
      values.name,
      JSON.stringify(permissions),
      prefix,
      hash,
    ]
      .map(quote)
      .join(", ")}, ${Date.now()})`,
  ],
  { stdio: ["ignore", "ignore", "inherit"] }
)

const me = await fetch(`${url}/api/v1/me`, { headers: { authorization: `Bearer ${key}` } })
if (!me.ok) fail(`The key was created, but ${url} rejected it (${me.status}). Is that the instance this checkout deploys?`)

if (values.save) {
  const dir = join(homedir(), ".config", "sendr")
  const file = join(dir, `${new URL(url).host}.env`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(
    file,
    [
      `# Sendr instance. Created by \`bun run api-key\` on ${new Date().toISOString().slice(0, 10)}.`,
      `SENDR_URL=${shellQuote(url)}`,
      `SENDR_API_KEY=${shellQuote(key)}`,
      `SENDR_CHECKOUT=${shellQuote(process.cwd())}`,
      "",
    ].join("\n"),
    { mode: 0o600 }
  )
  console.log(`Saved a ${permissions.join(", ")} key for ${url} to ${file}`)
} else {
  console.log(key)
}

function parseUrl(value: string | undefined) {
  if (!value) fail("Pass the instance's address, like https://emails.example.com")
  try {
    return new URL(value).origin
  } catch {
    fail(`${value} isn't a URL.`)
  }
}

function parsePermissions(value: string) {
  const list = [...new Set(value.split(",").map((part) => part.trim()))]
  const unknown = list.filter((part) => !API_KEY_PERMISSIONS.includes(part as ApiKeyPermission))
  if (unknown.length) fail(`Unknown permission: ${unknown.join(", ")}. Use ${API_KEY_PERMISSIONS.join(", ")}.`)
  return list as ApiKeyPermission[]
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

// The env file is sourced by a shell, so a checkout path with spaces or quotes survives.
function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
