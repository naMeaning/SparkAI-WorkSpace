package common

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestJsonRawMessageToString(t *testing.T) {
	tests := []struct {
		name string
		data json.RawMessage
		want string
	}{
		{
			name: "object",
			data: json.RawMessage(`{"city":"Paris","days":0,"strict":false}`),
			want: `{"city":"Paris","days":0,"strict":false}`,
		},
		{
			name: "string",
			data: json.RawMessage(`"{\"city\":\"Paris\",\"days\":0,\"strict\":false}"`),
			want: `{"city":"Paris","days":0,"strict":false}`,
		},
		{
			name: "null",
			data: json.RawMessage(`null`),
			want: "",
		},
		{
			name: "empty",
			data: nil,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, JsonRawMessageToString(tt.data))
		})
	}
}

func TestDecodeJsonStrict(t *testing.T) {
	type request struct {
		Name string `json:"name"`
	}

	tests := []struct {
		name    string
		body    string
		want    request
		wantErr bool
	}{
		{name: "single value", body: `{"name":"safe"}`, want: request{Name: "safe"}},
		{name: "unknown field", body: `{"name":"safe","prompt":"private"}`, wantErr: true},
		{name: "trailing value", body: `{"name":"safe"} {}`, wantErr: true},
		{name: "invalid JSON", body: `{"name":`, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var decoded request
			err := DecodeJsonStrict(bytes.NewBufferString(test.body), &decoded)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.want, decoded)
		})
	}
}
