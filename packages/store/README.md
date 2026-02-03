# @multica/store

Zustand state management for Multica apps.

## Usage

```tsx
// From barrel
import { useHubStore, useMessagesStore, useGatewayStore } from '@multica/store'

// Per-file subpath import
import { useGatewayStore } from '@multica/store/gateway'
import { useHubStore } from '@multica/store/hub'
import { useMessagesStore } from '@multica/store/messages'
import { useHubInit } from '@multica/store/hub-init'
import { useDeviceId } from '@multica/store/device-id'
```
