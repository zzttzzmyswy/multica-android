package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/realtime"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	hub := realtime.NewHub()
	go hub.Run()

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	// WebSocket
	r.Get("/ws", func(w http.ResponseWriter, r *http.Request) {
		realtime.HandleWebSocket(hub, w, r)
	})

	// Protected API routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth)

		// Issues
		r.Route("/api/issues", func(r chi.Router) {
			r.Get("/", placeholder("list issues"))
			r.Post("/", placeholder("create issue"))
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", placeholder("get issue"))
				r.Put("/", placeholder("update issue"))
				r.Delete("/", placeholder("delete issue"))
				r.Post("/comments", placeholder("add comment"))
				r.Get("/comments", placeholder("list comments"))
			})
		})

		// Agents
		r.Route("/api/agents", func(r chi.Router) {
			r.Get("/", placeholder("list agents"))
			r.Post("/", placeholder("create agent"))
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", placeholder("get agent"))
				r.Put("/", placeholder("update agent"))
				r.Get("/tasks", placeholder("list agent tasks"))
			})
		})

		// Inbox
		r.Route("/api/inbox", func(r chi.Router) {
			r.Get("/", placeholder("list inbox"))
			r.Post("/{id}/read", placeholder("mark read"))
			r.Post("/{id}/archive", placeholder("archive"))
		})

		// Workspaces
		r.Route("/api/workspaces", func(r chi.Router) {
			r.Get("/", placeholder("list workspaces"))
			r.Post("/", placeholder("create workspace"))
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", placeholder("get workspace"))
				r.Put("/", placeholder("update workspace"))
			})
		})
	})

	// Auth (public)
	r.Post("/auth/login", placeholder("login"))
	r.Get("/auth/callback", placeholder("oauth callback"))

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	// Graceful shutdown
	go func() {
		log.Printf("Server starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("Server stopped")
}

func placeholder(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		w.Write([]byte(`{"error":"not implemented","endpoint":"` + name + `"}`))
	}
}
