import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import type { z } from "zod"

/** Parses the query string or ends the request with 400 and the validation issues. */
export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return orBadRequest(schema.safeParse(c.req.query()))
}

/** Parses a JSON body or ends the request with 400 and the validation issues. */
export async function parseJson<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  return orBadRequest(schema.safeParse(await c.req.json().catch(() => undefined)))
}

function orBadRequest<T>(result: z.ZodSafeParseResult<T>): T {
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
