package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strings"
)

const maxUploadSize = 10 << 20 // 10 MB

// Allowed MIME type prefixes and exact types for uploads.
var allowedContentTypes = map[string]bool{
	"image/png":         true,
	"image/jpeg":        true,
	"image/gif":         true,
	"image/webp":        true,
	"image/svg+xml":     true,
	"application/pdf":   true,
	"text/plain":        true,
	"text/csv":          true,
	"application/json":  true,
	"video/mp4":         true,
	"video/webm":        true,
	"audio/mpeg":        true,
	"audio/wav":         true,
	"application/zip":   true,
}

func isContentTypeAllowed(ct string) bool {
	// Normalize: take only the media type, strip parameters like charset.
	ct = strings.TrimSpace(strings.SplitN(ct, ";", 2)[0])
	ct = strings.ToLower(ct)
	return allowedContentTypes[ct]
}

func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		writeError(w, http.StatusServiceUnavailable, "file upload not configured")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or invalid multipart form")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("missing file field: %v", err))
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	if !isContentTypeAllowed(contentType) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("file type not allowed: %s", contentType))
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		slog.Error("failed to generate file key", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	key := hex.EncodeToString(b) + path.Ext(header.Filename)

	link, err := h.Storage.Upload(r.Context(), key, data, contentType, header.Filename)
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
