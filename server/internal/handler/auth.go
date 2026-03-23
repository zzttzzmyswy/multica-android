package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/auth"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type UserResponse struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	AvatarURL *string `json:"avatar_url"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

func userToResponse(u db.User) UserResponse {
	return UserResponse{
		ID:        uuidToString(u.ID),
		Name:      u.Name,
		Email:     u.Email,
		AvatarURL: textToPtr(u.AvatarUrl),
		CreatedAt: timestampToString(u.CreatedAt),
		UpdatedAt: timestampToString(u.UpdatedAt),
	}
}

type LoginRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

type LoginResponse struct {
	Token string       `json:"token"`
	User  UserResponse `json:"user"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Name = strings.TrimSpace(req.Name)

	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	// Try to find existing user
	user, err := h.Queries.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		if !isNotFound(err) {
			writeError(w, http.StatusInternalServerError, "failed to load user")
			return
		}

		// Create new user
		name := req.Name
		if name == "" {
			name = req.Email
		}
		user, err = h.Queries.CreateUser(r.Context(), db.CreateUserParams{
			Name:  name,
			Email: req.Email,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create user: "+err.Error())
			return
		}
	} else if req.Name != "" && req.Name != user.Name {
		user, err = h.Queries.UpdateUser(r.Context(), db.UpdateUserParams{
			ID:   user.ID,
			Name: req.Name,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update user")
			return
		}
	}

	// Generate JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   uuidToString(user.ID),
		"email": user.Email,
		"name":  user.Name,
		"exp":   time.Now().Add(72 * time.Hour).Unix(),
		"iat":   time.Now().Unix(),
	})

	tokenString, err := token.SignedString(auth.JWTSecret())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, LoginResponse{
		Token: tokenString,
		User:  userToResponse(user),
	})
}

func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	user, err := h.Queries.GetUser(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	writeJSON(w, http.StatusOK, userToResponse(user))
}

type UpdateMeRequest struct {
	Name      *string `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req UpdateMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	currentUser, err := h.Queries.GetUser(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	name := currentUser.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
	}

	params := db.UpdateUserParams{
		ID:   currentUser.ID,
		Name: name,
	}
	if req.AvatarURL != nil {
		params.AvatarUrl = pgtype.Text{String: strings.TrimSpace(*req.AvatarURL), Valid: true}
	}

	updatedUser, err := h.Queries.UpdateUser(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	writeJSON(w, http.StatusOK, userToResponse(updatedUser))
}
