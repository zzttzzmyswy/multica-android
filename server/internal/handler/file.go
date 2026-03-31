package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
)

func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		writeError(w, http.StatusServiceUnavailable, "file upload not configured")
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("missing file field: %v", err))
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read file: %v", err))
		return
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		slog.Error("failed to generate file key", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	key := hex.EncodeToString(b) + path.Ext(header.Filename)

	contentType := header.Header.Get("Content-Type")
	link, err := h.Storage.Upload(r.Context(), key, data, contentType, map[string]string{
		"filename": header.Filename,
	})
	if err != nil {
		slog.Error("file upload failed", "error", err)
		writeError(w, http.StatusInternalServerError, "upload failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"filename": header.Filename,
		"link":     link,
	})
}
