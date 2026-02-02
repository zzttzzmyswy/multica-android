"use client"

import { useSyncExternalStore } from "react"
import { v7 as uuidv7 } from "uuid"

const STORAGE_KEY = "multica-device-id"

function getSnapshot(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = uuidv7()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb)
  return () => window.removeEventListener("storage", cb)
}

function getServerSnapshot(): string {
  return ""
}

export function useDeviceId(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
