package middleware

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/multica-ai/multica/server/internal/auth"
)

// Auth middleware validates JWT tokens from the Authorization header.
// Sets X-User-ID and X-User-Email headers on the request for downstream handlers.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.Debug("auth: missing authorization header", "path", r.URL.Path)
			http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			slog.Debug("auth: invalid format", "path", r.URL.Path)
			http.Error(w, `{"error":"invalid authorization format"}`, http.StatusUnauthorized)
			return
		}

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return auth.JWTSecret(), nil
		})
		if err != nil || !token.Valid {
			slog.Warn("auth: invalid token", "path", r.URL.Path, "error", err)
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			slog.Warn("auth: invalid claims", "path", r.URL.Path)
			http.Error(w, `{"error":"invalid claims"}`, http.StatusUnauthorized)
			return
		}

		sub, ok := claims["sub"].(string)
		if !ok || strings.TrimSpace(sub) == "" {
			slog.Warn("auth: invalid claims", "path", r.URL.Path)
			http.Error(w, `{"error":"invalid claims"}`, http.StatusUnauthorized)
			return
		}
		r.Header.Set("X-User-ID", sub)
		if email, ok := claims["email"].(string); ok {
			r.Header.Set("X-User-Email", email)
		}

		next.ServeHTTP(w, r)
	})
}
