import { renderToReadableStream } from "react-dom/server"
import { dehydrate } from "@tanstack/react-query"
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router"

import { AppProviders, routes, type RouteHandle } from "./App"
import { createQueryClient } from "@/lib/query-client"

const handler = createStaticHandler(routes)

/**
 * Renders the page for `request` with its data already loaded, into the built index.html.
 * Runs in the Worker; API calls go through the in-process fetch set up in worker/ssr.ts.
 */
export async function renderPage(request: Request, template: string) {
  const context = await handler.query(request)
  if (context instanceof Response) return context

  const queryClient = createQueryClient()
  const prefetch = (matches: typeof context.matches) =>
    Promise.all(
      matches.flatMap((match) =>
        (
          (match.route.handle as RouteHandle | undefined)?.load(match.params) ??
          []
        ).map((load) => load(queryClient))
      )
    )
  // The first match is the auth gate; page data only matters once it lets the page through.
  const [gate, ...pages] = context.matches
  await prefetch([gate])
  if (queryClient.getQueryData(["me"])) await prefetch(pages)

  const stream = await renderToReadableStream(
    <AppProviders client={queryClient}>
      <StaticRouterProvider
        router={createStaticRouter(handler.dataRoutes, context)}
        context={context}
        hydrate={false}
      />
    </AppProviders>
  )
  await stream.allReady
  const html = await new Response(stream).text()
  const state = JSON.stringify(dehydrate(queryClient)).replaceAll(
    "<",
    "\\u003c"
  )

  return new Response(
    template.replace(
      '<div id="root"></div>',
      `<div id="root">${html}</div><script>window.__SENDR_STATE__=${state}</script>`
    ),
    {
      status: context.statusCode,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  )
}
