package common

import "testing"

func TestFrontendPathRewritesHistoricalConsoleRoutes(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "topup", in: "/console/topup", want: "/wallet"},
		{name: "topup query", in: "/console/topup?amount=10", want: "/wallet?amount=10"},
		{name: "log", in: "/console/log?tab=consume", want: "/usage-logs?tab=consume"},
		{name: "personal", in: "/console/personal/security", want: "/profile/security"},
		{name: "unchanged", in: "/channels", want: "/channels"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FrontendPath(tt.in); got != tt.want {
				t.Fatalf("FrontendPath(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
