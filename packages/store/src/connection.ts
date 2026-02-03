const STORAGE_KEY = "multica-connection"

export interface ConnectionInfo {
  type: "multica-connect"
  gateway: string
  hubId: string
  agentId: string
  token: string
  expires: number
}

function isConnectionInfo(obj: unknown): obj is ConnectionInfo {
  if (typeof obj !== "object" || obj === null) return false
  const o = obj as Record<string, unknown>
  return (
    o.type === "multica-connect" &&
    typeof o.gateway === "string" &&
    typeof o.hubId === "string" &&
    typeof o.agentId === "string" &&
    typeof o.token === "string" &&
    typeof o.expires === "number"
  )
}

export function parseConnectionCode(input: string): ConnectionInfo {
  const trimmed = input.trim()

  // Try JSON first
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Try base64 decode then JSON
    try {
      parsed = JSON.parse(atob(trimmed))
    } catch {
      throw new Error("Invalid connection code")
    }
  }

  if (!isConnectionInfo(parsed)) {
    throw new Error("Invalid connection code format")
  }

  if (Date.now() > parsed.expires * 1000) {
    throw new Error("Connection code has expired")
  }

  return parsed
}

export function saveConnection(info: ConnectionInfo): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info))
}

export function loadConnection(): ConnectionInfo | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const info = JSON.parse(raw)
    if (!isConnectionInfo(info)) return null
    if (Date.now() > info.expires * 1000) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return info
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY)
}
