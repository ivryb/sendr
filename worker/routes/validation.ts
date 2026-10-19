import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import type { z } from "zod"

/** Parses a JSON body or ends the request with 400 and the validation issues. */
export async function parseJson<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json().catch(() => undefined))
  if (!result.success) {
    throw new HTTPException(400, {
      res: Response.json(
        { error: "invalid_request", issues: result.error.issues },
        { status: 400 }
      ),
    })
  }
  return result.data
}
