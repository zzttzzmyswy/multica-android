package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/realtime"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// NewRouter creates the fully-configured Chi router with all middleware and routes.
func NewRouter(queries *db.Queries, hub *realtime.Hub) chi.Router {
	h := handler.New(queries, hub)

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Workspace-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// WebSocket
	r.Get("/ws", func(w http.ResponseWriter, r *http.Request) {
		realtime.HandleWebSocket(hub, w, r)
	})

	// Auth (public)
	r.Post("/auth/login", h.Login)

	// Protected API routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth)

		// Auth
		r.Get("/api/me", h.GetMe)

		// Issues
		r.Route("/api/issues", func(r chi.Router) {
			r.Get("/", h.ListIssues)
			r.Post("/", h.CreateIssue)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.GetIssue)
				r.Put("/", h.UpdateIssue)
				r.Delete("/", h.DeleteIssue)
				r.Post("/comments", h.CreateComment)
				r.Get("/comments", h.ListComments)
			})
		})

		// Agents
		r.Route("/api/agents", func(r chi.Router) {
			r.Get("/", h.ListAgents)
			r.Post("/", h.CreateAgent)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.GetAgent)
				r.Put("/", h.UpdateAgent)
			})
		})

		// Inbox
		r.Route("/api/inbox", func(r chi.Router) {
			r.Get("/", h.ListInbox)
			r.Post("/{id}/read", h.MarkInboxRead)
			r.Post("/{id}/archive", h.ArchiveInboxItem)
		})

		// Workspaces
		r.Route("/api/workspaces", func(r chi.Router) {
			r.Get("/", h.ListWorkspaces)
			r.Post("/", h.CreateWorkspace)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.GetWorkspace)
				r.Put("/", h.UpdateWorkspace)
				r.Get("/members", h.ListMembersWithUser)
			})
		})
	})

	return r
}
