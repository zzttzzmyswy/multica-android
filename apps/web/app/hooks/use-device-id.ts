import { useState, useEffect } from "react"
import { v7 as uuidv7 } from "uuid"

const STORAGE_KEY = "multica-device-id"

export function useDeviceId(): string {
  const [deviceId, setDeviceId] = useState("")

  useEffect(() => {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = uuidv7()
      localStorage.setItem(STORAGE_KEY, id)
    }
    setDeviceId(id)
  }, [])

  return deviceId
}
