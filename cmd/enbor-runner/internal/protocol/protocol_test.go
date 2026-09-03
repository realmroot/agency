package protocol

import (
	"encoding/json"
	"strings"
	"testing"

	enbor "github.com/realmroot/enbor/sdk/go/enbor"
)

func TestParseWorkPayloadAcceptsSessionStart(t *testing.T) {
	prompt := "hello"
	payload, err := ParseWorkPayload(enbor.JSON{
		"protocol":           "enbor-runner-work",
		"type":               "session.start",
		"sessionId":          "session_1",
		"hostingMode":        "self_hosted",
		"runtime":            "codex",
		"provider":           "openai",
		"runtimeConfig":      enbor.JSON{"model": "gpt-5"},
		"runtimeRequirement": enbor.JSON{"runtime": "codex", "model": "gpt-5"},
		"prompt":             prompt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.SessionID != "session_1" || payload.Runtime != "codex" || payload.Prompt == nil || *payload.Prompt != prompt {
		t.Fatalf("unexpected parsed payload: %#v", payload)
	}
}

func TestParseWorkPayloadAcceptsRuntimeSelectedProviderAndModel(t *testing.T) {
	payload, err := ParseWorkPayload(enbor.JSON{
		"protocol":           "enbor-runner-work",
		"type":               "session.start",
		"sessionId":          "session_1",
		"hostingMode":        "self_hosted",
		"runtime":            "codex",
		"runtimeConfig":      enbor.JSON{},
		"runtimeRequirement": enbor.JSON{"runtime": "codex"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.Provider != "" || payload.Model != "" {
		t.Fatalf("expected provider and model to remain unpinned, got %#v", payload)
	}
}

func TestParseWorkPayloadNormalizesApprovedToolCall(t *testing.T) {
	payload, err := ParseWorkPayload(enbor.JSON{
		"protocol": "enbor-runner-work",
		"type":     "tool.execute",
		"toolCall": enbor.JSON{
			"id":        "call_1",
			"name":      "bash",
			"approved":  true,
			"arguments": enbor.JSON{"command": "true"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.ToolCallID != "call_1" || payload.ToolName != "bash" || payload.Input["command"] != "true" {
		t.Fatalf("unexpected parsed tool payload: %#v", payload)
	}
}

func TestParseWorkPayloadNormalizesNestedToolCallInput(t *testing.T) {
	payload, err := ParseWorkPayload(enbor.JSON{
		"protocol": "enbor-runner-work",
		"type":     "tool.execute",
		"toolCall": enbor.JSON{
			"id":       "call_1",
			"name":     "read",
			"approved": true,
			"input":    enbor.JSON{"path": "README.md"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.ToolCallID != "call_1" || payload.ToolName != "read" || payload.Input["path"] != "README.md" {
		t.Fatalf("unexpected parsed tool payload: %#v", payload)
	}
}

func TestParseWorkPayloadRejectsInvalidSessionStart(t *testing.T) {
	tests := []struct {
		name    string
		payload enbor.JSON
		want    string
	}{
		{
			name: "missing session id",
			payload: enbor.JSON{
				"protocol":           "enbor-runner-work",
				"type":               "session.start",
				"hostingMode":        "self_hosted",
				"runtime":            "codex",
				"provider":           "openai",
				"runtimeConfig":      enbor.JSON{},
				"runtimeRequirement": enbor.JSON{"runtime": "codex"},
			},
			want: "sessionId",
		},
		{
			name: "cloud hosting mode",
			payload: enbor.JSON{
				"protocol":           "enbor-runner-work",
				"type":               "session.start",
				"sessionId":          "session_1",
				"hostingMode":        "cloud",
				"runtime":            "codex",
				"provider":           "openai",
				"runtimeConfig":      enbor.JSON{},
				"runtimeRequirement": enbor.JSON{"runtime": "codex"},
			},
			want: "self_hosted",
		},
		{
			name: "missing runtime",
			payload: enbor.JSON{
				"protocol":           "enbor-runner-work",
				"type":               "session.start",
				"sessionId":          "session_1",
				"hostingMode":        "self_hosted",
				"provider":           "openai",
				"runtimeConfig":      enbor.JSON{},
				"runtimeRequirement": enbor.JSON{"runtime": "codex"},
			},
			want: "runtime and runtimeConfig",
		},
		{
			name: "missing runtime requirement",
			payload: enbor.JSON{
				"protocol":      "enbor-runner-work",
				"type":          "session.start",
				"sessionId":     "session_1",
				"hostingMode":   "self_hosted",
				"runtime":       "codex",
				"provider":      "openai",
				"runtimeConfig": enbor.JSON{},
			},
			want: "runtimeRequirement",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseWorkPayload(tc.payload)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}
}

func TestParseWorkPayloadRejectsUnsafeToolWork(t *testing.T) {
	_, err := ParseWorkPayload(enbor.JSON{
		"protocol": "enbor-runner-work",
		"type":     "tool.execute",
		"toolCall": enbor.JSON{
			"id":       "call_1",
			"name":     "bash",
			"approved": false,
			"input":    enbor.JSON{"command": "true"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected approval error, got %v", err)
	}
}

func TestParseWorkPayloadRejectsMalformedToolWork(t *testing.T) {
	tests := []struct {
		name    string
		payload enbor.JSON
		want    string
	}{
		{
			name:    "missing protocol",
			payload: enbor.JSON{"type": "tool.execute"},
			want:    "unsupported work protocol",
		},
		{
			name:    "unsupported protocol",
			payload: enbor.JSON{"protocol": "other"},
			want:    "unsupported work protocol",
		},
		{
			name: "missing tool call id",
			payload: enbor.JSON{
				"protocol": "enbor-runner-work",
				"type":     "tool.execute",
				"approved": true,
				"toolName": "bash",
				"input":    enbor.JSON{"command": "true"},
			},
			want: "toolCallId, toolName, and input",
		},
		{
			name: "missing input",
			payload: enbor.JSON{
				"protocol":   "enbor-runner-work",
				"type":       "tool.execute",
				"approved":   true,
				"toolCallId": "call_1",
				"toolName":   "bash",
			},
			want: "toolCallId, toolName, and input",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseWorkPayload(tc.payload)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}
}

func TestParseWorkPayloadRejectsUnsupportedSandboxTool(t *testing.T) {
	_, err := ParseWorkPayload(enbor.JSON{
		"protocol":   "enbor-runner-work",
		"type":       "tool.execute",
		"approved":   true,
		"toolCallId": "call_1",
		"toolName":   "sandbox.delete",
		"input":      enbor.JSON{"path": "file.txt"},
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported sandbox tool") {
		t.Fatalf("expected unsupported tool error, got %v", err)
	}
}

func TestParseWorkPayloadMapsWorkspaceManifest(t *testing.T) {
	prompt := "work"
	description := "repo"
	payload, err := ParseWorkPayload(enbor.JSON{
		"protocol":           "enbor-runner-work",
		"type":               "session.start",
		"sessionId":          "session_1",
		"hostingMode":        "self_hosted",
		"runtime":            "codex",
		"provider":           "openai",
		"model":              "gpt-5",
		"runtimeDriver":      "external",
		"runtimeConfig":      enbor.JSON{"model": "gpt-5"},
		"agentSnapshot":      enbor.JSON{"name": "agent"},
		"runtimeRequirement": enbor.JSON{"runtime": "codex", "model": "gpt-5"},
		"env":                map[string]string{"A": "B"},
		"prompt":             prompt,
		"resume":             true,
		"resumeToken":        "resume-token",
		"workspaceManifest": enbor.JSON{
			"root": "/workspace",
			"mounts": []enbor.JSON{
				{
					"type":        "git_repository",
					"name":        "repo",
					"mountPath":   "/workspace/repo",
					"url":         "https://example.test/repo.git",
					"ref":         "main",
					"description": description,
					"readOnly":    true,
					"credential":  enbor.JSON{"username": "user", "password": "pass"},
					"files": []enbor.JSON{
						{"path": "README.md", "content": "hello"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.Model != "gpt-5" || payload.RuntimeDriver != "external" || payload.Env["A"] != "B" ||
		payload.Prompt == nil || *payload.Prompt != prompt || !payload.Resume || payload.ResumeToken != "resume-token" {
		t.Fatalf("unexpected session fields: %#v", payload)
	}
	mount := payload.WorkspaceManifest.Mounts[0]
	if mount.Type != "git_repository" || mount.URL != "https://example.test/repo.git" || mount.Ref != "main" ||
		mount.Credential == nil || mount.Credential.Username != "user" || mount.Files[0].Content != "hello" ||
		mount.Description == nil || *mount.Description != description || !mount.ReadOnly {
		t.Fatalf("unexpected workspace mount: %#v", mount)
	}
}

func TestRunnerChannelMessageAccessors(t *testing.T) {
	eventID := "event_1"
	requestID := "request_1"
	sessionID := "session_1"
	toolCallID := "tool_1"
	toolName := "bash"
	readOnly := true
	input := map[string]any{"command": "true"}
	volumes := []enbor.RunnerVolume{
		{
			Type:      enbor.RunnerVolumeTypeGitRepository,
			Name:      "repo",
			Url:       ptr("https://example.test/repo.git"),
			Ref:       ptr("main"),
			SecretRef: ptr("enbor-secret://vault/git"),
		},
	}
	mounts := []enbor.RunnerVolumeMount{{Name: "repo", MountPath: "/workspace/repo", ReadOnly: &readOnly}}
	request := enbor.RunnerSandboxRequest{
		Type:         enbor.SandboxExecute,
		ToolCallId:   &toolCallID,
		ToolName:     &toolName,
		Input:        &input,
		Volumes:      &volumes,
		VolumeMounts: &mounts,
	}
	command := json.RawMessage(`{"type":"session.prompt"}`)
	message := RunnerChannelMessage{
		EventId:   &eventID,
		RequestId: &requestID,
		SessionId: &sessionID,
		Command:   command,
		Request:   &request,
		Type:      "sandbox.request",
	}
	if MessageEventID(message) != eventID || MessageRequestID(message) != requestID || MessageSessionID(message) != sessionID {
		t.Fatalf("unexpected ids from message: %#v", message)
	}
	if string(MessageCommand(message)) != string(command) {
		t.Fatalf("unexpected command")
	}
	sandbox := MessageSandboxRequest(message)
	if SandboxRequestType(sandbox) != "sandbox.execute" || SandboxRequestToolCallID(sandbox) != toolCallID ||
		SandboxRequestToolName(sandbox) != toolName || SandboxRequestInput(sandbox)["command"] != "true" {
		t.Fatalf("unexpected sandbox request: %#v", sandbox)
	}
	volume := SandboxRequestVolumes(sandbox)[0]
	if volume.Name != "repo" || volume.URL != "https://example.test/repo.git" {
		t.Fatalf("unexpected volume: %#v", volume)
	}
	mount := SandboxRequestVolumeMounts(sandbox)[0]
	if mount.Name != "repo" || mount.MountPath != "/workspace/repo" || !mount.ReadOnly {
		t.Fatalf("unexpected volume mount: %#v", mount)
	}
}

func TestRunnerChannelMessageAccessorsHandleMissingFields(t *testing.T) {
	if MessageEventID(RunnerChannelMessage{}) != "" || MessageRequestID(RunnerChannelMessage{}) != "" ||
		MessageSessionID(RunnerChannelMessage{}) != "" || MessageCommand(RunnerChannelMessage{}) != nil {
		t.Fatal("expected empty message accessors to return zero values")
	}
	request := MessageSandboxRequest(RunnerChannelMessage{})
	if SandboxRequestType(request) != "" || SandboxRequestToolCallID(request) != "" ||
		SandboxRequestToolName(request) != "" || SandboxRequestInput(request) != nil ||
		SandboxRequestVolumes(request) != nil || SandboxRequestVolumeMounts(request) != nil {
		t.Fatalf("expected empty sandbox request accessors, got %#v", request)
	}
	empty := enbor.RunnerSandboxRequest{}
	if SandboxRequestVolumes(empty) != nil || SandboxRequestVolumeMounts(empty) != nil {
		t.Fatal("expected nil request slices to stay nil")
	}
}

func TestWorkspaceSDKConvertersHandleNilAndOptionalFields(t *testing.T) {
	manifest := workspaceManifestFromSDK(nil)
	if manifest.Root != "/workspace" || len(manifest.Mounts) != 0 {
		t.Fatalf("unexpected default workspace manifest: %#v", manifest)
	}

	mounts := workspaceMountsFromSDK([]enbor.RunnerWorkspaceMount{
		{
			Type:      enbor.RunnerWorkspaceMountTypeMemory,
			Name:      "memory",
			MountPath: "/workspace/memory",
		},
	})
	if len(mounts) != 1 || mounts[0].Credential != nil || mounts[0].Files != nil ||
		mounts[0].Description != nil || mounts[0].ReadOnly {
		t.Fatalf("unexpected optional workspace mount fields: %#v", mounts)
	}

	volumes := volumesFromSDK(nil)
	mountList := volumeMountsFromSDK(nil)
	if volumes != nil || mountList != nil {
		t.Fatalf("expected nil converters to stay nil: %#v %#v", volumes, mountList)
	}
}

func ptr(value string) *string {
	return &value
}
