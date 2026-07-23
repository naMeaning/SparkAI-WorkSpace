package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
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
		{publicPath: "/iiimage/v1/responses", nativePath: "/v1/responses"},
		{publicPath: "/iiimage/v1/images/generations", nativePath: "/v1/images/generations"},
		{publicPath: "/iiimage/v1/images/edits", nativePath: "/v1/images/edits"},
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

func TestManagedSessionRelayRegistersCanonicalAndLegacyPublicRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetRelayRouter(engine)

	routes := map[string]struct{}{}
	for _, route := range engine.Routes() {
		routes[route.Method+" "+route.Path] = struct{}{}
	}

	for _, basePath := range []string{managedRelayCanonicalBasePath, managedRelayLegacyBasePath} {
		for _, route := range []string{
			http.MethodGet + " " + basePath + "/models",
			http.MethodPost + " " + basePath + "/chat/completions",
			http.MethodPost + " " + basePath + "/responses",
			http.MethodPost + " " + basePath + "/responses/compact",
			http.MethodPost + " " + basePath + "/images/generations",
			http.MethodPost + " " + basePath + "/images/edits",
		} {
			_, exists := routes[route]
			require.True(t, exists, "missing managed session relay route %s", route)
		}
	}
}

func TestManagedRelayNativePathLeavesUnrelatedPathUntouched(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	managedRelayNativePath()(context)
	require.Equal(t, "/api/status", context.Request.URL.Path)
}
