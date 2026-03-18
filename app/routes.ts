import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // Site — public pages
  layout("routes/site/layout.tsx", [
    index("routes/site/home.tsx"),
    route("pricing", "routes/site/pricing.tsx"),
    route("about", "routes/site/about.tsx"),
  ]),

  // Login — guest only
  layout("routes/login/layout.tsx", [
    route("login", "routes/login/login.tsx"),
    route("register", "routes/login/register.tsx"),
  ]),

  // Platform — authenticated
  layout("routes/platform/layout.tsx", [
    route("platform", "routes/platform/dashboard.tsx"),
    route("platform/new", "routes/platform/new-translation.tsx"),
    route("platform/translations", "routes/platform/translations.tsx"),
    route("platform/translations/:id", "routes/platform/translation.tsx"),
    route("platform/settings", "routes/platform/settings.tsx"),
    route("platform/billing", "routes/platform/billing.tsx"),
  ]),
] satisfies RouteConfig;
