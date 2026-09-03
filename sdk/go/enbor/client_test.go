package enbor

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

type bearerRoundTripper struct {
	base  http.RoundTripper
	token string
}

type dpopRoundTripper struct {
	base  http.RoundTripper
	token string
	proof string
}

func (t dpopRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.Header.Set("authorization", "DPoP "+t.token)
	clone.Header.Set("dpop", t.proof)
	return t.base.RoundTrip(clone)
}

func dpopHTTPClient(base *http.Client, token, proof string) *http.Client {
	return &http.Client{Transport: dpopRoundTripper{base: base.Transport, token: token, proof: proof}}
}

func (t bearerRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.Header.Set("authorization", "Bearer "+t.token)
	clone.Header.Del("dpop")
	return t.base.RoundTrip(clone)
}

func bearerHTTPClient(base *http.Client, token string) *http.Client {
	return &http.Client{Transport: bearerRoundTripper{base: base.Transport, token: token}}
}

func TestClientFacadeConfiguresHeadersAndCallsGeneratedOperation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/runners" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("authorization"); got != "DPoP token_1" {
			t.Fatalf("expected authorization header, got %q", got)
		}
		if got := r.Header.Get("dpop"); got != "proof_1" {
			t.Fatalf("expected DPoP proof header, got %q", got)
		}
		if got := r.Header.Get("x-ama-project-id"); got != "project_1" {
			t.Fatalf("expected project header, got %q", got)
		}
		var body CreateRunnerRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("expected JSON body, got %v", err)
		}
		if body.Name != "runner-a" {
			t.Fatalf("expected request body to be encoded, got %#v", body)
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{
			"archivedAt": null,
			"authMode": "realmroot",
			"createdAt": "2026-01-01T00:00:00Z",
			"currentLoad": 0,
			"environmentId": null,
			"id": "runner_1",
			"lastHeartbeatAt": null,
			"maxConcurrent": 1,
			"metadata": {},
			"name": "runner-a",
			"projectId": "project_1",
			"runtimes": [],
			"runtimeUsage": [],
			"secretRef": null,
			"state": "active",
			"updatedAt": "2026-01-01T00:00:00Z"
		}`))
	}))
	defer server.Close()

	client, err := New(ClientConfig{
		BaseURL:    server.URL,
		ProjectID:  "project_1",
		HTTPClient: dpopHTTPClient(server.Client(), "token_1", "proof_1"),
	})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	runner, err := client.Runners.Create(context.Background(), CreateRunnerRequest{Name: "runner-a"})
	if err != nil {
		t.Fatalf("expected runner create success, got %v", err)
	}
	if runner.Id != "runner_1" {
		t.Fatalf("expected decoded runner, got %#v", runner)
	}
}

func TestRunnerClientFacadeUsesBearerForHTTP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/runners" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("authorization"); got != "Bearer runner_token" {
			t.Fatalf("expected runner Bearer authorization, got %q", got)
		}
		if got := r.Header.Get("dpop"); got != "" {
			t.Fatalf("runner HTTP request must not include DPoP proof, got %q", got)
		}
		if got := r.Header.Get("x-ama-project-id"); got != "project_runner" {
			t.Fatalf("expected project header, got %q", got)
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{
			"archivedAt": null,
			"authMode": "realmroot",
			"createdAt": "2026-01-01T00:00:00Z",
			"currentLoad": 0,
			"environmentId": null,
			"id": "runner_http",
			"lastHeartbeatAt": null,
			"maxConcurrent": 1,
			"metadata": {},
			"name": "runner-http",
			"projectId": "project_runner",
			"runtimes": [],
			"runtimeUsage": [],
			"secretRef": null,
			"state": "active",
			"updatedAt": "2026-01-01T00:00:00Z"
		}`))
	}))
	defer server.Close()

	client, err := NewRunner(ClientConfig{
		BaseURL:    server.URL,
		ProjectID:  "project_runner",
		HTTPClient: bearerHTTPClient(server.Client(), "runner_token"),
	})
	if err != nil {
		t.Fatalf("expected runner client, got %v", err)
	}
	runner, err := client.Runners.Create(context.Background(), CreateRunnerRequest{Name: "runner-http"})
	if err != nil {
		t.Fatalf("expected runner create success, got %v", err)
	}
	if runner.Id != "runner_http" {
		t.Fatalf("expected decoded runner, got %#v", runner)
	}
}

func TestRunnerClientFacadeOpensRunnerWebSocketChannel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/runners/runner_42/channel" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("authorization"); got != "Bearer token_ws" {
			t.Fatalf("expected authorization header, got %q", got)
		}
		if got := r.Header.Get("dpop"); got != "" {
			t.Fatalf("runner WebSocket must not include DPoP proof, got %q", got)
		}
		if got := r.Header.Get("x-ama-project-id"); got != "project_ws" {
			t.Fatalf("expected project header, got %q", got)
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Fatalf("expected websocket upgrade, got %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "done")
	}))
	defer server.Close()

	client, err := NewRunner(ClientConfig{
		BaseURL:    server.URL,
		ProjectID:  "project_ws",
		HTTPClient: bearerHTTPClient(server.Client(), "token_ws"),
	})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	channel, err := client.Runners.Channel(context.Background(), "runner_42")
	if err != nil {
		t.Fatalf("expected runner channel, got %v", err)
	}
	if err := channel.Close(1000, "test complete"); err != nil {
		t.Fatalf("expected close success, got %v", err)
	}
}

func TestRunnerWebSocketChannelReadsLargeMessages(t *testing.T) {
	const largeBodySize = 64 << 10
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Fatalf("expected websocket upgrade, got %v", err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "done")
		payload := JSON{"type": "work.assigned", "body": strings.Repeat("x", largeBodySize)}
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("expected marshal success, got %v", err)
		}
		if err := conn.Write(r.Context(), websocket.MessageText, data); err != nil {
			t.Fatalf("expected websocket write success, got %v", err)
		}
	}))
	defer server.Close()

	client, err := NewRunner(ClientConfig{BaseURL: server.URL})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	channel, err := client.Runners.Channel(context.Background(), "runner_42")
	if err != nil {
		t.Fatalf("expected runner channel, got %v", err)
	}
	defer channel.Close(1000, "test complete")
	var message JSON
	if err := channel.ReadJSON(context.Background(), &message); err != nil {
		t.Fatalf("expected large message read success, got %v", err)
	}
	if len(message["body"].(string)) != largeBodySize {
		t.Fatalf("expected large body to round-trip, got %#v", message["body"])
	}
}

func TestClientFacadeReturnsAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"type":"conflict","message":"runner already exists"}}`))
	}))
	defer server.Close()

	client, err := New(ClientConfig{BaseURL: server.URL})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	_, err = client.Runners.Create(context.Background(), CreateRunnerRequest{Name: "runner-a"})
	if err == nil {
		t.Fatal("expected API error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T %[1]v", err)
	}
	if apiErr.Status != http.StatusConflict || apiErr.ResponseText != "runner already exists" {
		t.Fatalf("unexpected API error %#v", apiErr)
	}
	if status, ok := StatusCode(err); !ok || status != http.StatusConflict {
		t.Fatalf("expected status helper to expose 409, got %d %v", status, ok)
	}
}

func TestIdentityFacadeForwardsRequiredIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/identities" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("idempotency-key"); got != "identity-idempotency-1" {
			t.Fatalf("expected Identity idempotency key, got %q", got)
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"type":"fixture_stop","message":"header captured"}}`))
	}))
	defer server.Close()

	client, err := New(ClientConfig{BaseURL: server.URL})
	if err != nil {
		t.Fatalf("expected client, got %v", err)
	}
	_, err = client.Identities.Create(
		context.Background(),
		&CreateIdentityParams{IdempotencyKey: "identity-idempotency-1"},
		CreateIdentityRequest{},
	)
	if err == nil {
		t.Fatal("expected fixture response to stop after header capture")
	}
}

func TestCreationFacadesHandleOptionalIdempotencyKey(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		idempotencyKey string
		invoke         func(context.Context, *Client, *string) error
	}{
		{
			name: "agents legacy create omits header",
			path: "/api/v1/agents",
			invoke: func(ctx context.Context, client *Client, _ *string) error {
				_, err := client.Agents.Create(ctx, CreateAgentRequest{})
				return err
			},
		},
		{
			name:           "agents create with params forwards header",
			path:           "/api/v1/agents",
			idempotencyKey: "agent-idempotency-1",
			invoke: func(ctx context.Context, client *Client, key *string) error {
				_, err := client.Agents.CreateWithParams(ctx, &CreateAgentParams{IdempotencyKey: key}, CreateAgentRequest{})
				return err
			},
		},
		{
			name: "environments legacy create omits header",
			path: "/api/v1/environments",
			invoke: func(ctx context.Context, client *Client, _ *string) error {
				_, err := client.Environments.Create(ctx, CreateEnvironmentRequest{})
				return err
			},
		},
		{
			name:           "environments create with params forwards header",
			path:           "/api/v1/environments",
			idempotencyKey: "environment-idempotency-1",
			invoke: func(ctx context.Context, client *Client, key *string) error {
				_, err := client.Environments.CreateWithParams(
					ctx,
					&CreateEnvironmentParams{IdempotencyKey: key},
					CreateEnvironmentRequest{},
				)
				return err
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != test.path || r.Method != http.MethodPost {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				if got := r.Header.Get("idempotency-key"); got != test.idempotencyKey {
					t.Fatalf("expected idempotency key %q, got %q", test.idempotencyKey, got)
				}
				w.Header().Set("content-type", "application/json")
				w.WriteHeader(http.StatusConflict)
				_, _ = w.Write([]byte(`{"error":{"type":"fixture_stop","message":"header captured"}}`))
			}))
			defer server.Close()

			client, err := New(ClientConfig{BaseURL: server.URL})
			if err != nil {
				t.Fatalf("expected client, got %v", err)
			}
			var key *string
			if test.idempotencyKey != "" {
				key = &test.idempotencyKey
			}
			if err := test.invoke(context.Background(), client, key); err == nil {
				t.Fatal("expected fixture response to stop after header capture")
			}
		})
	}
}
