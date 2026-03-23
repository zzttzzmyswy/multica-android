package handler

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/internal/realtime"
)

type txStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

type Handler struct {
	Queries   *db.Queries
	TxStarter txStarter
	Hub       *realtime.Hub
}

func New(queries *db.Queries, txStarter txStarter, hub *realtime.Hub) *Handler {
	return &Handler{Queries: queries, TxStarter: txStarter, Hub: hub}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func parseUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	_ = u.Scan(s)
	return u
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	dst := make([]byte, 36)
	hex.Encode(dst[0:8], b[0:4])
	dst[8] = '-'
	hex.Encode(dst[9:13], b[4:6])
	dst[13] = '-'
	hex.Encode(dst[14:18], b[6:8])
	dst[18] = '-'
	hex.Encode(dst[19:23], b[8:10])
	dst[23] = '-'
	hex.Encode(dst[24:36], b[10:16])
	return string(dst)
}

func textToPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func ptrToText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func strToText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func timestampToString(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}

func timestampToPtr(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.Format(time.RFC3339)
	return &s
}

func uuidToPtr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := uuidToString(u)
	return &s
}

// broadcast sends a WebSocket event to all connected clients.
func (h *Handler) broadcast(eventType string, payload any) {
	msg := map[string]any{
		"type":    eventType,
		"payload": payload,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		fmt.Printf("broadcast marshal error: %v\n", err)
		return
	}
	h.Hub.Broadcast(data)
}

func isNotFound(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func requestUserID(r *http.Request) string {
	return r.Header.Get("X-User-ID")
}

func requireUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID := requestUserID(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return "", false
	}
	return userID, true
}

func resolveWorkspaceID(r *http.Request) string {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID != "" {
		return workspaceID
	}
	return r.Header.Get("X-Workspace-ID")
}

func roleAllowed(role string, roles ...string) bool {
	for _, candidate := range roles {
		if role == candidate {
			return true
		}
	}
	return false
}

func countOwners(members []db.Member) int {
	owners := 0
	for _, member := range members {
		if member.Role == "owner" {
			owners++
		}
	}
	return owners
}

func (h *Handler) getWorkspaceMember(ctx context.Context, userID, workspaceID string) (db.Member, error) {
	return h.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID:      parseUUID(userID),
		WorkspaceID: parseUUID(workspaceID),
	})
}

func (h *Handler) requireWorkspaceMember(w http.ResponseWriter, r *http.Request, workspaceID, notFoundMsg string) (db.Member, bool) {
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return db.Member{}, false
	}

	userID, ok := requireUserID(w, r)
	if !ok {
		return db.Member{}, false
	}

	member, err := h.getWorkspaceMember(r.Context(), userID, workspaceID)
	if err != nil {
		writeError(w, http.StatusNotFound, notFoundMsg)
		return db.Member{}, false
	}

	return member, true
}

func (h *Handler) requireWorkspaceRole(w http.ResponseWriter, r *http.Request, workspaceID, notFoundMsg string, roles ...string) (db.Member, bool) {
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, notFoundMsg)
	if !ok {
		return db.Member{}, false
	}
	if !roleAllowed(member.Role, roles...) {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return db.Member{}, false
	}
	return member, true
}

func (h *Handler) loadIssueForUser(w http.ResponseWriter, r *http.Request, issueID string) (db.Issue, bool) {
	if _, ok := requireUserID(w, r); !ok {
		return db.Issue{}, false
	}

	issue, err := h.Queries.GetIssue(r.Context(), parseUUID(issueID))
	if err != nil {
		writeError(w, http.StatusNotFound, "issue not found")
		return db.Issue{}, false
	}

	if _, ok := h.requireWorkspaceMember(w, r, uuidToString(issue.WorkspaceID), "issue not found"); !ok {
		return db.Issue{}, false
	}

	return issue, true
}

func (h *Handler) loadAgentForUser(w http.ResponseWriter, r *http.Request, agentID string) (db.Agent, bool) {
	if _, ok := requireUserID(w, r); !ok {
		return db.Agent{}, false
	}

	agent, err := h.Queries.GetAgent(r.Context(), parseUUID(agentID))
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found")
		return db.Agent{}, false
	}

	if _, ok := h.requireWorkspaceMember(w, r, uuidToString(agent.WorkspaceID), "agent not found"); !ok {
		return db.Agent{}, false
	}

	return agent, true
}

func (h *Handler) loadInboxItemForUser(w http.ResponseWriter, r *http.Request, itemID string) (db.InboxItem, bool) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return db.InboxItem{}, false
	}

	item, err := h.Queries.GetInboxItem(r.Context(), parseUUID(itemID))
	if err != nil {
		writeError(w, http.StatusNotFound, "inbox item not found")
		return db.InboxItem{}, false
	}

	if item.RecipientType != "member" || uuidToString(item.RecipientID) != userID {
		writeError(w, http.StatusNotFound, "inbox item not found")
		return db.InboxItem{}, false
	}

	return item, true
}
