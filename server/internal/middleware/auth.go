package middleware

import (
	"net/http"
)

// Auth middleware validates JWT tokens from the Authorization header.
// TODO: Implement JWT validation.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TODO: Extract and validate JWT from Authorization header
		// For now, pass through all requests during development
		next.ServeHTTP(w, r)
	})
}
