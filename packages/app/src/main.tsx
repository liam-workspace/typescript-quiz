import "@pp/app/index.css"
// Side-effect import, and it must stay one: `i18n.ts` calls `i18n.init()` at
// module scope, and nothing else in the app imports it. Without this line
// i18next is never initialised and EVERY screen renders raw keys --
// `signIn.button` where a child should read "Sign in". That shipped: 752
// tests, four green gates, six locales in parity and zero i18n-lint
// findings, because every component test builds its OWN i18next instance
// inline. The suite was supplying the production code the app had forgotten.
import "@pp/app/i18n"
import { routeTree } from "@pp/app/route.gen"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
