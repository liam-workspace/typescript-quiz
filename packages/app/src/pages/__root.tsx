import { createRootRoute } from "@tanstack/react-router"
import { AppLayout } from "./layout.js"

export const Route = createRootRoute({
  component: AppLayout,
})
