import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes"

export default [
  route("sign-in", "pages/sign-in.tsx"),
  layout("components/app-shell.tsx", [
    layout("components/page-errors.tsx", [
      index("pages/home.ts", { id: "home" }),
      route("campaigns", "pages/campaigns.tsx"),
      route("campaigns/:id", "pages/campaign.tsx"),
      route("contacts", "pages/contacts.tsx"),
      route("settings", "pages/settings.tsx"),
      route("*", "pages/home.ts", { id: "not-found" }),
    ]),
  ]),
] satisfies RouteConfig
