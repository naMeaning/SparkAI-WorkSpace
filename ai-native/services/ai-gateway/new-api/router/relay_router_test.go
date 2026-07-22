package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestManagedRelayNativePathRewritesOnlyInsideHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, path := range []string{
		"/iiimage/v1/responses",
		"/iiimage/v1/images/generations",
		"/iiimage/v1/images/edits",
	} {
		path := path
		t.Run(path, func(t *testing.T) {
			engine := gin.New()
			observed := ""
			engine.POST(path, managedRelayNativePath(), func(c *gin.Context) {
				observed = c.Request.URL.Path
				c.Status(http.StatusNoContent)
			})

			request := httptest.NewRequest(http.MethodPost, path+"?probe=1", nil)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusNoContent, recorder.Code)
			require.Equal(t, strings.TrimPrefix(path, "/iiimage"), observed)
			require.Equal(t, path, request.URL.Path)
			require.Equal(t, "probe=1", request.URL.RawQuery)
		})
	}
}

func TestManagedRelayNativePathLeavesUnrelatedPathUntouched(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	managedRelayNativePath()(context)
	require.Equal(t, "/api/status", context.Request.URL.Path)
}
