package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// Presigned direct-upload support for the S3 backend.
//
// The upload primitive is a presigned PUT against a staging key. A PUT
// credential cannot carry a size or content-type condition of its own, so the
// server enforces both after the fact: it inspects the staged object, then
// copies it to a final key under an If-Match on the ETag it inspected. A client
// that re-PUTs its (still valid) staging URL therefore cannot change the bytes
// of a published attachment — the copy either matches the inspected version or
// fails. The final key is never presigned, so no client credential can write
// it directly.

// presignPutTTL bounds one PUT credential. S3 rejects an expiry beyond seven
// days for SigV4; the API's own limit (900s) is set by the handler, and this
// default only applies when a caller passes a non-positive ttl.
const presignPutTTL = 15 * time.Minute

// presignPutMaxTTL is the SigV4 ceiling for a presigned URL.
const presignPutMaxTTL = 7 * 24 * time.Hour

// PresignPut returns a presigned PUT for one object key. Content-Length and
// Content-Type are folded into the signature so the store itself rejects a
// body of the wrong size or type even before complete-upload inspects it.
//
// Why Content-Length is signed: an unsigned PUT accepts any number of bytes,
// so a client could park a 5 GiB object in the bucket using a credential issued
// for a 1 KiB upload. Signing x-amz-decoded-content-length would not help —
// that header is for chunked framing — so the length is bound by SigV4's
// content-length-in-signature rule, which the SDK applies to the canonical
// request.
func (s *S3Storage) PresignPut(ctx context.Context, key string, ttl time.Duration, contentType string, contentLength int64) (string, map[string]string, error) {
	if key == "" {
		return "", nil, fmt.Errorf("s3 PresignPut: empty key")
	}
	if contentLength < 0 {
		return "", nil, fmt.Errorf("s3 PresignPut: content length is required")
	}
	if ttl <= 0 {
		ttl = presignPutTTL
	}
	if ttl > presignPutMaxTTL {
		ttl = presignPutMaxTTL
	}
	input := &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(contentLength),
	}
	out, err := s.presignClient().PresignPutObject(ctx, input, func(opts *s3.PresignOptions) {
		opts.Expires = ttl
	})
	if err != nil {
		return "", nil, fmt.Errorf("s3 PresignPutObject: %w", err)
	}
	// Report exactly the headers the signature covers, read back from the
	// presign result rather than assumed: telling a client to send a header the
	// store will not verify (or to omit one it will) produces an opaque
	// SignatureDoesNotMatch at upload time. Host is set by any HTTP client and
	// is not the caller's to supply.
	headers := map[string]string{}
	for name := range out.SignedHeader {
		switch strings.ToLower(name) {
		case "content-type":
			headers["Content-Type"] = contentType
		case "content-length":
			headers["Content-Length"] = fmt.Sprintf("%d", contentLength)
		}
	}
	return out.URL, headers, nil
}

func (s *S3Storage) presignClient() *s3.PresignClient {
	return s3.NewPresignClient(s.client)
}

// HeadObject reports the stored object's size, ETag and recorded content type.
// A missing key returns ErrObjectNotFound so callers can distinguish "the
// client never finished its PUT" from "the store is unavailable".
func (s *S3Storage) HeadObject(ctx context.Context, key string) (ObjectInfo, error) {
	if key == "" {
		return ObjectInfo{}, fmt.Errorf("s3 HeadObject: empty key")
	}
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s.uploadChecksumOptions()...)
	if err != nil {
		if isS3NotFound(err) {
			return ObjectInfo{}, ErrObjectNotFound
		}
		return ObjectInfo{}, fmt.Errorf("s3 HeadObject: %w", err)
	}
	info := ObjectInfo{
		ETag:        strings.Trim(aws.ToString(out.ETag), `"`),
		ContentType: aws.ToString(out.ContentType),
	}
	if out.ContentLength != nil {
		info.Size = *out.ContentLength
	}
	return info, nil
}

// ReadPrefix reads at most n leading bytes of an object, for MIME sniffing and
// image dimension extraction. The body is closed on every path.
func (s *S3Storage) ReadPrefix(ctx context.Context, key string, n int) ([]byte, error) {
	if key == "" {
		return nil, fmt.Errorf("s3 ReadPrefix: empty key")
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Range:  aws.String(fmt.Sprintf("bytes=0-%d", int64(n))),
	}, s.uploadChecksumOptions()...)
	if err != nil {
		if isS3NotFound(err) {
			return nil, ErrObjectNotFound
		}
		return nil, fmt.Errorf("s3 GetObject: %w", err)
	}
	defer out.Body.Close()
	buf, err := io.ReadAll(io.LimitReader(out.Body, int64(n)+1))
	if err != nil {
		return nil, fmt.Errorf("s3 GetObject body: %w", err)
	}
	return buf, nil
}

// FinalizeObject copies the staged object to its permanent key under an
// If-Match on the ETag the caller inspected, then — because S3's copy is a
// single atomic operation that applies the destination metadata — removes the
// staging object only after the copy succeeded.
//
// MetadataDirective REPLACE is what makes the destination's Content-Type and
// Content-Disposition the server's decision rather than the uploader's: the
// presigned PUT stored whatever header the client sent, and carrying it over
// (COPY) would republish a client-controlled type. This same call therefore
// implements both "finalize" and "set verified metadata".
func (s *S3Storage) FinalizeObject(ctx context.Context, srcKey, srcETag, dstKey string, expectedSize int64, contentType, contentDisposition, cacheControl string) error {
	if srcKey == "" || dstKey == "" {
		return fmt.Errorf("s3 FinalizeObject: source and destination keys are required")
	}
	if srcKey == dstKey {
		return fmt.Errorf("s3 FinalizeObject: source and destination are the same key")
	}
	if strings.TrimSpace(srcETag) == "" {
		// Without a precondition the copy is an unconditional read of whatever
		// the staging key holds right now, which is exactly the substitution
		// this whole path exists to prevent.
		return fmt.Errorf("s3 FinalizeObject: source ETag is required for the conditional copy")
	}
	input := &s3.CopyObjectInput{
		Bucket:             aws.String(s.bucket),
		Key:                aws.String(dstKey),
		CopySource:         aws.String(copySource(s.bucket, srcKey)),
		CopySourceIfMatch:  aws.String(`"` + strings.Trim(srcETag, `"`) + `"`),
		MetadataDirective:  types.MetadataDirectiveReplace,
		ContentType:        aws.String(contentType),
		ContentDisposition: aws.String(contentDisposition),
		CacheControl:       aws.String(cacheControl),
		StorageClass:       s.storageClass(),
	}
	if _, err := s.client.CopyObject(ctx, input, s.uploadChecksumOptions()...); err != nil {
		switch {
		case isS3NotFound(err):
			return ErrObjectNotFound
		case isS3PreconditionFailed(err):
			return ErrSourceChanged
		default:
			return fmt.Errorf("s3 CopyObject: %w", err)
		}
	}
	// Re-read the destination rather than trusting the copy response: the
	// published size is what a download will actually serve, and a copy that
	// silently truncated would otherwise be recorded as the declared size.
	info, err := s.HeadObject(ctx, dstKey)
	if err != nil {
		return fmt.Errorf("s3 FinalizeObject: verify destination: %w", err)
	}
	if info.Size != expectedSize {
		// Leave both objects in place: the caller's recovery path decides
		// whether to retry or fail, and deleting here would race the retry.
		return fmt.Errorf("s3 FinalizeObject: destination is %d bytes, expected %d", info.Size, expectedSize)
	}
	return nil
}

// copySource builds the x-amz-copy-source value. Each path segment is escaped
// individually so a key containing a space or a slash survives the round trip;
// S3 requires the header's value to be URL-encoded.
func copySource(bucket, key string) string {
	segments := strings.Split(key, "/")
	for i, segment := range segments {
		segments[i] = escapeCopySourceSegment(segment)
	}
	return bucket + "/" + strings.Join(segments, "/")
}

func escapeCopySourceSegment(segment string) string {
	// url.PathEscape escapes the characters that break the header (space, "?",
	// "#") but leaves "+" alone, and S3 would read a literal "+" as a space.
	return strings.ReplaceAll(url.PathEscape(segment), "+", "%2B")
}

// isS3NotFound distinguishes "this object does not exist" from a transport or
// authorization failure. Both a typed NoSuchKey and the generic NotFound (which
// is what this SDK returns for a missing key on several S3-compatible stores)
// mean the same thing to a caller.
func isS3NotFound(err error) bool {
	var noKey *types.NoSuchKey
	if errors.As(err, &noKey) {
		return true
	}
	var notFound *types.NotFound
	if errors.As(err, &notFound) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound", "404":
			return true
		}
	}
	// HEAD responses carry no body, so the SDK cannot decode an error code and
	// reports the bare status instead.
	var respErr interface{ HTTPStatusCode() int }
	if errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusNotFound {
		return true
	}
	return false
}

// isS3PreconditionFailed reports a failed If-Match on the copy source — the
// staged object changed between inspection and finalization.
func isS3PreconditionFailed(err error) bool {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		if apiErr.ErrorCode() == "PreconditionFailed" {
			return true
		}
	}
	var respErr interface{ HTTPStatusCode() int }
	if errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusPreconditionFailed {
		return true
	}
	return false
}
