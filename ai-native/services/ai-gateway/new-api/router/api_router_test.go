package router

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDesktopDownloadRegistersCanonicalAndLegacyRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	registerDesktopDownloadRoutes(engine)

	routes := engine.Routes()
	require.Len(t, routes, 2)
	registered := make(map[string]string, len(routes))
	for _, route := range routes {
		registered[route.Path] = route.Method
	}

	assert.Equal(t, http.MethodGet, registered[desktopDownloadCanonicalPath])
	assert.Equal(t, http.MethodGet, registered[desktopDownloadLegacyPath])
}
