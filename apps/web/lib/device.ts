/**
 * Device ID management for Multica Web
 * Stores encrypted format directly (40 hex chars)
 */

const DEVICE_ID_KEY = 'MULTICA_DEVICE_ID'

// SHA-256 hash function (using Web Crypto API)
async function sha256(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generate encrypted device ID (40 hex chars)
async function generateEncryptedDeviceId(): Promise<string> {
  const uuid = crypto.randomUUID()
  const firstHash = (await sha256(uuid)).slice(0, 32)
  return (await sha256(firstHash)).slice(0, 8) + firstHash
}

// Validate encrypted ID format (40 hex characters)
function isValidEncryptedId(id: string): boolean {
  return typeof id === 'string' && /^[a-f0-9]{40}$/i.test(id)
}

// Cached promise for async generation
let deviceIdPromise: Promise<string> | null = null

/**
 * Get or create Device ID (encrypted 40-char format)
 * Stored in localStorage, ready to use directly
 */
export async function getOrCreateDeviceId(): Promise<string> {
  if (typeof window === 'undefined') return ''

  const existing = localStorage.getItem(DEVICE_ID_KEY)

  // If already encrypted format, return as-is
  if (existing && isValidEncryptedId(existing)) {
    return existing
  }

  // Generate new encrypted ID
  if (!deviceIdPromise) {
    deviceIdPromise = generateEncryptedDeviceId().then((id) => {
      localStorage.setItem(DEVICE_ID_KEY, id)
      return id
    })
  }

  return deviceIdPromise
}

