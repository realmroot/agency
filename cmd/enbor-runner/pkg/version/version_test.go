package version

import "testing"

func TestDefaultAndNormalizedVersionInfo(t *testing.T) {
	info := Default()
	if info.Name != "enbor-runner" || info.Version == "" || info.Commit == "" || info.BuildDate == "" {
		t.Fatalf("unexpected default version info: %#v", info)
	}
	normalized := (Info{}).Normalized()
	if normalized.Name != "enbor-runner" || normalized.Version == "" || normalized.Commit == "" || normalized.BuildDate == "" {
		t.Fatalf("unexpected normalized empty info: %#v", normalized)
	}
	custom := (Info{Name: "runner", Version: "1", Commit: "abc", BuildDate: "today"}).Normalized()
	if custom.Name != "runner" || custom.Version != "1" || custom.Commit != "abc" || custom.BuildDate != "today" {
		t.Fatalf("unexpected normalized custom info: %#v", custom)
	}
}
