package common

import (
	"os"
	"strings"
)

// GetTrustedProxies returns the only proxy addresses whose forwarding headers
// Gin may trust. Release mode defaults to trusting none; production deployment
// must explicitly provide the Caddy network through TRUSTED_PROXIES.
func GetTrustedProxies() []string {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		if strings.EqualFold(strings.TrimSpace(os.Getenv("GIN_MODE")), "release") {
			return nil
		}
		return []string{"127.0.0.1", "::1"}
	}
	if strings.EqualFold(raw, "none") {
		return nil
	}
	seen := map[string]struct{}{}
	result := make([]string, 0)
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, exists := seen[item]; exists {
			continue
		}
		seen[item] = struct{}{}
		result = append(result, item)
	}
	return result
}
