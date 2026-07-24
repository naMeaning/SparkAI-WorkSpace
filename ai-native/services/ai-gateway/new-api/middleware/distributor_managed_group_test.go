package middleware

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveManagedSessionRelayGroup(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(c, constant.ContextKeyUserGroup, "default")

	group, err := resolveManagedSessionRelayGroup(c, "default", "not-visible-to-user")
	require.NoError(t, err)
	assert.Equal(t, "default", group, "ordinary token relays must ignore body group overrides")

	c.Set("managed_session_relay", true)
	group, err = resolveManagedSessionRelayGroup(c, "default", "default")
	require.NoError(t, err)
	assert.Equal(t, "default", group)

	group, err = resolveManagedSessionRelayGroup(c, "default", "not-visible-to-user")
	assert.ErrorIs(t, err, errManagedSessionRelayGroupAccessDenied)
	assert.Equal(t, "default", group)
}

func TestManagedSessionRelayGroupParsesJSONAndMultipart(t *testing.T) {
	t.Run("json", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/generations", bytes.NewBufferString(`{"model":"gpt-image-2","group":"image"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		request, err := getModelFromRequest(c)
		require.NoError(t, err)
		assert.Equal(t, "gpt-image-2", request.Model)
		assert.Equal(t, "image", request.Group)
	})

	t.Run("multipart", func(t *testing.T) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-2"))
		require.NoError(t, writer.WriteField("group", "image"))
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		request, err := getModelFromRequest(c)
		require.NoError(t, err)
		assert.Equal(t, "gpt-image-2", request.Model)
		assert.Equal(t, "image", request.Group)
	})
}
