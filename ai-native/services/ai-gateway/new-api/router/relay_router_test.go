package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagedRelayNativePathRewritesOnlyInsideHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, testCase := range []struct {
		publicPath string
		nativePath string
	}{
		{publicPath: "/naimage/v1/responses", nativePath: "/v1/responses"},
		{publicPath: "/naimage/v1/images/generations", nativePath: "/v1/images/generations"},
		{publicPath: "/naimage/v1/images/edits", nativePath: "/v1/images/edits"},
	} {
		testCase := testCase
		t.Run(testCase.publicPath, func(t *testing.T) {
			engine := gin.New()
			observed := ""
			engine.POST(testCase.publicPath, managedRelayNativePath(), func(c *gin.Context) {
				observed = c.Request.URL.Path
				c.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodPost, testCase.publicPath+"?probe=1", nil)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusNoContent, recorder.Code)
			require.Equal(t, testCase.nativePath, observed)
			require.Equal(t, testCase.publicPath, request.URL.Path)
			require.Equal(t, "probe=1", request.URL.RawQuery)
		})
	}
}

func TestManagedSessionRelayRegistersNaimagePublicRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetRelayRouter(engine)

	routes := map[string]struct{}{}
	for _, route := range engine.Routes() {
		routes[route.Method+" "+route.Path] = struct{}{}
	}

	for _, route := range []string{
		http.MethodGet + " " + managedRelayBasePath + "/models",
		http.MethodPost + " " + managedRelayBasePath + "/chat/completions",
		http.MethodPost + " " + managedRelayBasePath + "/responses",
		http.MethodPost + " " + managedRelayBasePath + "/responses/compact",
		http.MethodPost + " " + managedRelayBasePath + "/images/generations",
		http.MethodPost + " " + managedRelayBasePath + "/images/edits",
	} {
		_, exists := routes[route]
		require.True(t, exists, "missing managed session relay route %s", route)
	}
	for _, legacyPath := range []string{
		"/iiimage/v1/models",
		"/iiimage/v1/chat/completions",
		"/iiimage/v1/responses",
		"/iiimage/v1/responses/compact",
		"/iiimage/v1/images/generations",
		"/iiimage/v1/images/edits",
	} {
		_, exists := routes[http.MethodGet+" "+legacyPath]
		_, postExists := routes[http.MethodPost+" "+legacyPath]
		assert.False(t, exists || postExists, "legacy managed relay route must stay unregistered: %s", legacyPath)
	}
}

func TestManagedRelayNativePathLeavesUnrelatedPathUntouched(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	managedRelayNativePath()(context)
	require.Equal(t, "/api/status", context.Request.URL.Path)
}
