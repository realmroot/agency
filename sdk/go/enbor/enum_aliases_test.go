package enbor_test

import (
	"testing"

	"github.com/realmroot/enbor/sdk/go/enbor"
)

func TestLegacyTriggerSuspendConstants(t *testing.T) {
	// Inferred variable types preserve existing callers that take their address.
	trueValue := enbor.True
	falseValue := enbor.False
	for _, tc := range []struct {
		name  string
		value *enbor.ListTriggersParamsSuspend
		want  string
	}{
		{"true", &trueValue, "true"},
		{"false", &falseValue, "false"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request, err := enbor.NewListTriggersRequest("https://enbor.example.test", &enbor.ListTriggersParams{Suspend: tc.value})
			if err != nil {
				t.Fatal(err)
			}
			if got := request.URL.Query().Get("suspend"); got != tc.want {
				t.Fatalf("suspend = %q, want %q", got, tc.want)
			}
		})
	}
}
