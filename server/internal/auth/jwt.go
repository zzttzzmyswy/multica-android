package auth

import (
	"os"
	"sync"
)

const defaultJWTSecret = "multica-dev-secret-change-in-production"

var (
	jwtSecret     []byte
	jwtSecretOnce sync.Once
)

func JWTSecret() []byte {
	jwtSecretOnce.Do(func() {
		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			secret = defaultJWTSecret
		}
		jwtSecret = []byte(secret)
	})

	return jwtSecret
}
