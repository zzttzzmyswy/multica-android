import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v7 as uuidv7 } from 'uuid'

interface DeviceState {
  deviceId: string
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    () => ({
      deviceId: uuidv7(),
    }),
    { name: 'multica-device' }
  )
)
