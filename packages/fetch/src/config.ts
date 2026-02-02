let consoleUrl = "http://localhost:4000"
let gatewayUrl = "http://localhost:3000"

export function setConfig(config: { consoleUrl?: string; gatewayUrl?: string }) {
  if (config.consoleUrl) consoleUrl = config.consoleUrl
  if (config.gatewayUrl) gatewayUrl = config.gatewayUrl
}

export function getConsoleUrl(): string {
  return consoleUrl
}

export function getGatewayUrl(): string {
  return gatewayUrl
}
