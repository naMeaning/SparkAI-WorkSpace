package common

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetTrustedProxiesTrustsNoneByDefaultInRelease(t *testing.T) {
	t.Setenv("GIN_MODE", "release")
	t.Setenv("TRUSTED_PROXIES", "")
	require.Nil(t, GetTrustedProxies())
}

func TestGetTrustedProxiesParsesExplicitCIDRs(t *testing.T) {
	t.Setenv("GIN_MODE", "release")
	t.Setenv("TRUSTED_PROXIES", "172.19.0.0/16, 127.0.0.1,172.19.0.0/16")
	require.Equal(t, []string{"172.19.0.0/16", "127.0.0.1"}, GetTrustedProxies())
}
