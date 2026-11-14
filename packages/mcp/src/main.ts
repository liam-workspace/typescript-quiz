import { createGatewayApp } from "./protocol/create-app.js"
import { loadGatewayConfigFromProcess } from "./config.js"

const config = loadGatewayConfigFromProcess()
const server = createGatewayApp(config).listen(config.port)

function shutdown(): void {
  server.close(() => process.exit(0))
}

process.once("SIGTERM", shutdown)
process.once("SIGINT", shutdown)
