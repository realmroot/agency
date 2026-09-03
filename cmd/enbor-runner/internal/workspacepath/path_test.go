package workspacepath

import (
	"path/filepath"
	"testing"
)

func TestRelativeUsesPlatformIndependentWorkspacePaths(t *testing.T) {
	for _, test := range []struct {
		input string
		want  string
	}{
		{"notes/plan.md", filepath.Join("notes", "plan.md")},
		{"/workspace/notes/plan.md", filepath.Join("notes", "plan.md")},
	} {
		got, err := Relative(test.input, false)
		if err != nil || got != test.want {
			t.Fatalf("Relative(%q) = %q, %v; want %q", test.input, got, err, test.want)
		}
	}
	if got, err := Relative(Root, true); err != nil || got != "." {
		t.Fatalf("workspace root = %q, %v", got, err)
	}
	for _, input := range []string{"", Root, "/outside", "../outside", "notes/../../outside", `C:\outside`, `notes\plan.md`} {
		if _, err := Relative(input, false); err == nil {
			t.Fatalf("expected %q to be rejected", input)
		}
	}
}
