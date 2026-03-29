package main

import (
	"encoding/json"
	"log/slog"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/realtime"
)

// registerListeners wires up event bus listeners for WS broadcasting.
// Uses SubscribeAll to automatically broadcast ALL events to WebSocket clients,
// eliminating the need to maintain a manual event type list.
func registerListeners(bus *events.Bus, hub *realtime.Hub) {
	bus.SubscribeAll(func(e events.Event) {
		msg := map[string]any{
			"type":    e.Type,
			"payload": e.Payload,
		}
		data, err := json.Marshal(msg)
		if err != nil {
			slog.Error("failed to marshal event", "event_type", e.Type, "error", err)
			return
		}
		if e.WorkspaceID != "" {
			hub.BroadcastToWorkspace(e.WorkspaceID, data)
		} else {
			hub.Broadcast(data)
		}
	})
}
