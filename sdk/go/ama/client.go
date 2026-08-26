package ama

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/coder/websocket"
)

// Regenerate the typed models and REST client (ama.gen.go) from the OpenAPI doc.
// Requires oapi-codegen on PATH:
//   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
// The config's paths (overlay, output) resolve from sdk/go, so run from there.
// `go generate` invokes this from the package dir, hence the `cd ..`.
//go:generate sh -c "cd .. && oapi-codegen -config oapi-codegen.config.yaml ../openapi.json"

type JSON = map[string]interface{}

type ClientConfig struct {
	BaseURL    string
	ProjectID  string
	Headers    map[string]string
	HTTPClient *http.Client
}

type clientCore struct {
	raw        *ClientWithResponses
	baseURL    string
	projectID  string
	headers    map[string]string
	httpClient *http.Client
}

type Client struct {
	core         *clientCore
	Configz      ConfigzService
	Auth         AuthService
	Projects     ProjectsService
	Agents       AgentsService
	Environments EnvironmentsService
	Providers    ProvidersService
	Runners      RunnersService
	Budgets      BudgetsService
	Connectors   ConnectorsService
	Audit        AuditService
	Triggers     TriggersService
	Sessions     SessionsService
	MemoryStores MemoryStoresService
	Vaults       VaultsService
	Usage        UsageService
}

type RunnerClient struct {
	core      *clientCore
	Configz   RunnerConfigzService
	Runners   RunnerRunnersService
	WorkItems RunnerWorkItemsService
	Leases    RunnerLeasesService
	Sessions  RunnerSessionsService
}

func New(config ClientConfig) (*Client, error) {
	core, err := newClientCore(config)
	if err != nil {
		return nil, err
	}
	client := &Client{core: core}
	client.Configz = ConfigzService{client: core}
	client.Auth = AuthService{client: core}
	client.Projects = ProjectsService{client: core}
	client.Agents = AgentsService{client: core}
	client.Environments = EnvironmentsService{client: core}
	client.Providers = ProvidersService{client: core}
	client.Runners = RunnersService{client: core}
	client.Budgets = BudgetsService{client: core}
	client.Connectors = ConnectorsService{client: core}
	client.Audit = AuditService{client: core}
	client.Triggers = TriggersService{client: core}
	client.Sessions = SessionsService{client: core}
	client.MemoryStores = MemoryStoresService{client: core}
	client.Vaults = VaultsService{client: core}
	client.Usage = UsageService{client: core}
	return client, nil
}

func NewRunner(config ClientConfig) (*RunnerClient, error) {
	core, err := newClientCore(config)
	if err != nil {
		return nil, err
	}
	client := &RunnerClient{core: core}
	client.Configz = RunnerConfigzService{client: core}
	client.Runners = RunnerRunnersService{client: core}
	client.WorkItems = RunnerWorkItemsService{client: core}
	client.Leases = RunnerLeasesService{client: core}
	client.Sessions = RunnerSessionsService{client: core}
	return client, nil
}

func newClientCore(config ClientConfig) (*clientCore, error) {
	if strings.TrimSpace(config.BaseURL) == "" {
		return nil, fmt.Errorf("AMA base URL is required")
	}
	headers := map[string]string{}
	for key, value := range config.Headers {
		headers[key] = value
	}
	opts := []ClientOption{
		WithRequestEditorFn(func(ctx context.Context, request *http.Request) error {
			if config.ProjectID != "" {
				request.Header.Set("x-ama-project-id", config.ProjectID)
			}
			for key, value := range headers {
				request.Header.Set(key, value)
			}
			return nil
		}),
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	opts = append(opts, WithHTTPClient(httpClient))
	baseURL := strings.TrimRight(config.BaseURL, "/")
	raw, err := NewClientWithResponses(baseURL, opts...)
	if err != nil {
		return nil, err
	}
	return &clientCore{raw: raw, baseURL: baseURL, projectID: config.ProjectID, headers: headers, httpClient: httpClient}, nil
}

func (c *Client) Raw() *ClientWithResponses {
	return c.core.raw
}

func (c *RunnerClient) Raw() *ClientWithResponses {
	return c.core.raw
}

type APIError struct {
	Status       int
	ResponseText string
	Body         any
}

func (e *APIError) Error() string {
	if e.Status == 0 {
		return "AMA API request failed"
	}
	if e.ResponseText != "" {
		return fmt.Sprintf("AMA API request failed with HTTP %d: %s", e.Status, e.ResponseText)
	}
	return fmt.Sprintf("AMA API request failed with HTTP %d", e.Status)
}

func StatusCode(err error) (int, bool) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status, true
	}
	return 0, false
}

type JSONChannel interface {
	ReadJSON(ctx context.Context, out any) error
	WriteJSON(ctx context.Context, value any) error
	Close(statusCode int, reason string) error
}

type WebSocketChannel struct {
	Conn *websocket.Conn
}

const webSocketReadLimit = 16 << 20

func (c *WebSocketChannel) ReadJSON(ctx context.Context, out any) error {
	_, data, err := c.Conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func (c *WebSocketChannel) WriteJSON(ctx context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.Conn.Write(ctx, websocket.MessageText, data)
}

func (c *WebSocketChannel) Close(statusCode int, reason string) error {
	return c.Conn.Close(websocket.StatusCode(statusCode), reason)
}

func (c *clientCore) dialWebSocket(ctx context.Context, path string) (JSONChannel, error) {
	endpoint, err := c.webSocketURL(path)
	if err != nil {
		return nil, err
	}
	headers := http.Header{}
	for key, value := range c.headers {
		headers.Set(key, value)
	}
	if c.projectID != "" {
		headers.Set("x-ama-project-id", c.projectID)
	}
	conn, _, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{HTTPClient: c.httpClient, HTTPHeader: headers})
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(webSocketReadLimit)
	return &WebSocketChannel{Conn: conn}, nil
}

func (c *clientCore) webSocketURL(path string) (string, error) {
	parsed, err := url.Parse(c.baseURL)
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	default:
		return "", fmt.Errorf("AMA base URL must use http or https")
	}
	parsed.Path = path
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

type ConfigzService struct {
	client *clientCore
}

func (s ConfigzService) Get(ctx context.Context) (*PublicConfig, error) {
	response, err := s.client.raw.ReadConfigzWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200)
}

type AuthService struct {
	client *clientCore
}

func (s AuthService) Config(ctx context.Context, params *ReadAuthConfigParams) (*AuthConfig, error) {
	response, err := s.client.raw.ReadAuthConfigWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200)
}

func (s AuthService) CurrentSession(ctx context.Context) (*AuthSession, error) {
	response, err := s.client.raw.ReadCurrentAuthSessionWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403)
}

type ProjectsService struct {
	client *clientCore
}

func (s ProjectsService) List(ctx context.Context, params *ListProjectsParams) (*ProjectListResponse, error) {
	response, err := s.client.raw.ListProjectsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s ProjectsService) Create(ctx context.Context, body CreateProjectRequest) (*Project, error) {
	response, err := s.client.raw.CreateProjectWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON401, response.JSON403)
}

func (s ProjectsService) Get(ctx context.Context, projectID string) (*Project, error) {
	response, err := s.client.raw.ReadProjectWithResponse(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

type AgentsService struct {
	client *clientCore
}

func (s AgentsService) List(ctx context.Context, params *ListAgentsParams) (*AgentListResponse, error) {
	response, err := s.client.raw.ListAgentsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s AgentsService) Create(ctx context.Context, params *CreateAgentParams, body CreateAgentRequest) (*Agent, error) {
	response, err := s.client.raw.CreateAgentWithResponse(ctx, params, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON409, response.JSON502)
}

func (s AgentsService) Get(ctx context.Context, agentID string) (*Agent, error) {
	response, err := s.client.raw.ReadAgentWithResponse(ctx, agentID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s AgentsService) Update(ctx context.Context, agentID string, body UpdateAgentRequest) (*Agent, error) {
	response, err := s.client.raw.UpdateAgentWithResponse(ctx, agentID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s AgentsService) Retire(ctx context.Context, agentID string, params *RetireAgentParams) error {
	response, err := s.client.raw.RetireAgentWithResponse(ctx, agentID, params)
	if err != nil {
		return err
	}
	return unwrapEmpty(response.StatusCode(), response.Body, response.JSON401, response.JSON403, response.JSON404, response.JSON502)
}

func (s AgentsService) ListVersions(ctx context.Context, agentID string) (*AgentVersionListResponse, error) {
	response, err := s.client.raw.ListAgentVersionsWithResponse(ctx, agentID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s AgentsService) GetVersion(ctx context.Context, agentID string, version int) (*AgentVersion, error) {
	response, err := s.client.raw.ReadAgentVersionWithResponse(ctx, agentID, version)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

type EnvironmentsService struct {
	client *clientCore
}

func (s EnvironmentsService) List(ctx context.Context, params *ListEnvironmentsParams) (*EnvironmentListResponse, error) {
	response, err := s.client.raw.ListEnvironmentsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s EnvironmentsService) Create(ctx context.Context, body CreateEnvironmentRequest) (*Environment, error) {
	response, err := s.client.raw.CreateEnvironmentWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403)
}

func (s EnvironmentsService) Get(ctx context.Context, environmentID string) (*Environment, error) {
	response, err := s.client.raw.ReadEnvironmentWithResponse(ctx, environmentID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s EnvironmentsService) Update(ctx context.Context, environmentID string, body UpdateEnvironmentRequest) (*Environment, error) {
	response, err := s.client.raw.UpdateEnvironmentWithResponse(ctx, environmentID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s EnvironmentsService) ListVersions(ctx context.Context, environmentID string) (*EnvironmentVersionListResponse, error) {
	response, err := s.client.raw.ListEnvironmentVersionsWithResponse(ctx, environmentID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s EnvironmentsService) GetVersion(ctx context.Context, environmentID string, version int) (*EnvironmentVersion, error) {
	response, err := s.client.raw.ReadEnvironmentVersionWithResponse(ctx, environmentID, version)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

type ProvidersService struct {
	client *clientCore
}

func (s ProvidersService) List(ctx context.Context) (*ProviderListResponse, error) {
	response, err := s.client.raw.ListProvidersWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403)
}

func (s ProvidersService) ListModels(ctx context.Context) (*ProviderModelListResponse, error) {
	response, err := s.client.raw.ListModelsWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403)
}

func (s ProvidersService) RefreshCatalog(ctx context.Context) (*CatalogRefreshResult, error) {
	response, err := s.client.raw.RefreshCatalogWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403)
}

func (s ProvidersService) Get(ctx context.Context, providerID string) (*Provider, error) {
	response, err := s.client.raw.ReadProviderWithResponse(ctx, providerID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s ProvidersService) ListProviderModels(ctx context.Context, providerID string) (*ProviderModelListResponse, error) {
	response, err := s.client.raw.ListProviderModelsWithResponse(ctx, providerID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

type RunnersService struct {
	client *clientCore
}

func (s RunnersService) List(ctx context.Context, params *ListRunnersParams) (*RunnerListResponse, error) {
	response, err := s.client.raw.ListRunnersWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s RunnersService) Create(ctx context.Context, body CreateRunnerRequest) (*Runner, error) {
	response, err := s.client.raw.CreateRunnerWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON409)
}

func (s RunnersService) Get(ctx context.Context, runnerID string) (*Runner, error) {
	response, err := s.client.raw.ReadRunnerWithResponse(ctx, runnerID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s RunnersService) Update(ctx context.Context, runnerID string, body UpdateRunnerRequest) (*Runner, error) {
	response, err := s.client.raw.UpdateRunnerWithResponse(ctx, runnerID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type BudgetsService struct {
	client *clientCore
}

func (s BudgetsService) List(ctx context.Context) (*BudgetListResponse, error) {
	response, err := s.client.raw.ListBudgetsWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403)
}

func (s BudgetsService) Create(ctx context.Context, body CreateBudgetRequest) (*Budget, error) {
	response, err := s.client.raw.CreateBudgetWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403)
}

func (s BudgetsService) Get(ctx context.Context, budgetID string) (*Budget, error) {
	response, err := s.client.raw.ReadBudgetWithResponse(ctx, budgetID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s BudgetsService) Update(ctx context.Context, budgetID string, body UpdateBudgetRequest) (*Budget, error) {
	response, err := s.client.raw.UpdateBudgetWithResponse(ctx, budgetID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s BudgetsService) Delete(ctx context.Context, budgetID string) error {
	response, err := s.client.raw.DeleteBudgetWithResponse(ctx, budgetID)
	if err != nil {
		return err
	}
	return unwrapEmpty(response.StatusCode(), response.Body, response.JSON401, response.JSON403, response.JSON404)
}

type ConnectorsService struct {
	client *clientCore
}

func (s ConnectorsService) List(ctx context.Context, params *ListConnectorsParams) (*ConnectorListResponse, error) {
	response, err := s.client.raw.ListConnectorsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s ConnectorsService) Get(ctx context.Context, connectorID string) (*Connector, error) {
	response, err := s.client.raw.ReadConnectorWithResponse(ctx, connectorID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

type AuditService struct {
	client *clientCore
}

func (s AuditService) ListRecords(ctx context.Context, params *ListAuditRecordsParams) (*AuditRecordListResponse, error) {
	response, err := s.client.raw.ListAuditRecordsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s AuditService) GetRecord(ctx context.Context, recordID string) (*AuditRecord, error) {
	response, err := s.client.raw.ReadAuditRecordWithResponse(ctx, recordID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

type TriggersService struct {
	client *clientCore
}

func (s TriggersService) List(ctx context.Context, params *ListTriggersParams) (*TriggerListResponse, error) {
	response, err := s.client.raw.ListTriggersWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s TriggersService) Create(ctx context.Context, body CreateTriggerRequest) (*Trigger, error) {
	response, err := s.client.raw.CreateTriggerWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s TriggersService) Get(ctx context.Context, triggerID string) (*Trigger, error) {
	response, err := s.client.raw.ReadTriggerWithResponse(ctx, triggerID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s TriggersService) Update(ctx context.Context, triggerID string, body UpdateTriggerRequest) (*Trigger, error) {
	response, err := s.client.raw.UpdateTriggerWithResponse(ctx, triggerID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s TriggersService) Delete(ctx context.Context, triggerID string) error {
	response, err := s.client.raw.DeleteTriggerWithResponse(ctx, triggerID)
	if err != nil {
		return err
	}
	return unwrapEmpty(response.StatusCode(), response.Body, response.JSON401, response.JSON403, response.JSON404)
}

func (s TriggersService) ListRuns(ctx context.Context, triggerID string, params *ListTriggerRunsParams) (*TriggerRunListResponse, error) {
	response, err := s.client.raw.ListTriggerRunsWithResponse(ctx, triggerID, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s TriggersService) CreateRun(ctx context.Context, triggerID string, body CreateHttpTriggerRunRequest) (*TriggerRun, error) {
	response, err := s.client.raw.CreateTriggerRunWithResponse(ctx, triggerID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s TriggersService) GetRun(ctx context.Context, triggerID string, runID string) (*TriggerRun, error) {
	response, err := s.client.raw.ReadTriggerRunWithResponse(ctx, triggerID, runID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

type SessionsService struct {
	client *clientCore
}

func (s SessionsService) List(ctx context.Context, params *ListSessionsParams) (*SessionListResponse, error) {
	response, err := s.client.raw.ListSessionsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s SessionsService) Create(ctx context.Context, body CreateSessionRequest) (*Session, error) {
	response, err := s.client.raw.CreateSessionWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s SessionsService) Get(ctx context.Context, sessionID string) (*Session, error) {
	response, err := s.client.raw.ReadSessionWithResponse(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s SessionsService) Update(ctx context.Context, sessionID string, body UpdateSessionRequest) (*Session, error) {
	response, err := s.client.raw.UpdateSessionWithResponse(ctx, sessionID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s SessionsService) Stream(ctx context.Context, sessionID string) (JSONChannel, error) {
	return s.client.dialWebSocket(ctx, "/api/v1/sessions/"+url.PathEscape(sessionID)+"/socket")
}

func (s SessionsService) ListMessages(ctx context.Context, sessionID string, params *ListSessionMessagesParams) (*SessionMessageListResponse, error) {
	response, err := s.client.raw.ListSessionMessagesWithResponse(ctx, sessionID, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s SessionsService) CreateMessage(ctx context.Context, sessionID string, body CreateSessionMessageRequest) (*SessionMessage, error) {
	response, err := s.client.raw.CreateSessionMessageWithResponse(ctx, sessionID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409, response.JSON500)
}

func (s SessionsService) GetMessage(ctx context.Context, sessionID string, messageID string) (*SessionMessage, error) {
	response, err := s.client.raw.ReadSessionMessageWithResponse(ctx, sessionID, messageID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s SessionsService) ListEvents(ctx context.Context, sessionID string, params *ListSessionEventsParams) (*SessionEventListResponse, error) {
	response, err := s.client.raw.ListSessionEventsWithResponse(ctx, sessionID, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s SessionsService) ListApprovals(ctx context.Context, sessionID string) (*SessionApprovalListResponse, error) {
	response, err := s.client.raw.ListSessionApprovalsWithResponse(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s SessionsService) GetApproval(ctx context.Context, sessionID string, approvalID string) (*SessionApproval, error) {
	response, err := s.client.raw.ReadSessionApprovalWithResponse(ctx, sessionID, approvalID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s SessionsService) DecideApproval(ctx context.Context, sessionID string, approvalID string, body SessionApprovalDecisionRequest) (*SessionApproval, error) {
	response, err := s.client.raw.DecideSessionApprovalWithResponse(ctx, sessionID, approvalID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type MemoryStoresService struct {
	client *clientCore
}

func (s MemoryStoresService) List(ctx context.Context, params *ListMemoryStoresParams) (*MemoryStoreListResponse, error) {
	response, err := s.client.raw.ListMemoryStoresWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s MemoryStoresService) Create(ctx context.Context, body CreateMemoryStoreRequest) (*MemoryStore, error) {
	response, err := s.client.raw.CreateMemoryStoreWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403)
}

func (s MemoryStoresService) Get(ctx context.Context, storeID string) (*MemoryStore, error) {
	response, err := s.client.raw.ReadMemoryStoreWithResponse(ctx, storeID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s MemoryStoresService) Update(ctx context.Context, storeID string, body UpdateMemoryStoreRequest) (*MemoryStore, error) {
	response, err := s.client.raw.UpdateMemoryStoreWithResponse(ctx, storeID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s MemoryStoresService) ListMemories(ctx context.Context, storeID string, params *ListMemoryStoreMemoriesParams) (*MemoryStoreMemoryListResponse, error) {
	response, err := s.client.raw.ListMemoryStoreMemoriesWithResponse(ctx, storeID, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s MemoryStoresService) CreateMemory(ctx context.Context, storeID string, body CreateMemoryStoreMemoryRequest) (*MemoryStoreMemory, error) {
	response, err := s.client.raw.CreateMemoryStoreMemoryWithResponse(ctx, storeID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s MemoryStoresService) UpdateMemory(ctx context.Context, storeID string, memoryID string, body UpdateMemoryStoreMemoryRequest) (*MemoryStoreMemory, error) {
	response, err := s.client.raw.UpdateMemoryStoreMemoryWithResponse(ctx, storeID, memoryID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s MemoryStoresService) DeleteMemory(ctx context.Context, storeID string, memoryID string) error {
	response, err := s.client.raw.DeleteMemoryStoreMemoryWithResponse(ctx, storeID, memoryID)
	if err != nil {
		return err
	}
	return unwrapEmpty(response.StatusCode(), response.Body, response.JSON401, response.JSON403, response.JSON404)
}

type VaultsService struct {
	client *clientCore
}

func (s VaultsService) List(ctx context.Context, params *ListVaultsParams) (*VaultListResponse, error) {
	response, err := s.client.raw.ListVaultsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s VaultsService) Create(ctx context.Context, body CreateVaultRequest) (*Vault, error) {
	response, err := s.client.raw.CreateVaultWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403)
}

func (s VaultsService) Get(ctx context.Context, vaultID string) (*Vault, error) {
	response, err := s.client.raw.ReadVaultWithResponse(ctx, vaultID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s VaultsService) Update(ctx context.Context, vaultID string, body UpdateVaultRequest) (*Vault, error) {
	response, err := s.client.raw.UpdateVaultWithResponse(ctx, vaultID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s VaultsService) ListCredentials(ctx context.Context, vaultID string, params *ListVaultCredentialsParams) (*VaultCredentialListResponse, error) {
	response, err := s.client.raw.ListVaultCredentialsWithResponse(ctx, vaultID, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s VaultsService) CreateCredential(ctx context.Context, vaultID string, body CreateVaultCredentialRequest) (*VaultCredential, error) {
	response, err := s.client.raw.CreateVaultCredentialWithResponse(ctx, vaultID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s VaultsService) GetCredential(ctx context.Context, vaultID string, credentialID string) (*VaultCredential, error) {
	response, err := s.client.raw.ReadVaultCredentialWithResponse(ctx, vaultID, credentialID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s VaultsService) UpdateCredential(ctx context.Context, vaultID string, credentialID string, body UpdateVaultCredentialRequest) (*VaultCredential, error) {
	response, err := s.client.raw.UpdateVaultCredentialWithResponse(ctx, vaultID, credentialID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s VaultsService) UpdateCredentialSecret(ctx context.Context, vaultID string, credentialID string, body UpdateVaultCredentialSecretRequest) (*VaultCredential, error) {
	response, err := s.client.raw.UpdateVaultCredentialSecretWithResponse(ctx, vaultID, credentialID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s VaultsService) ListCredentialVersions(ctx context.Context, vaultID string, credentialID string, params *ListVaultCredentialVersionsParams) (*VaultCredentialVersionListResponse, error) {
	response, err := s.client.raw.ListVaultCredentialVersionsWithResponse(ctx, vaultID, credentialID, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s VaultsService) GetCredentialVersion(ctx context.Context, vaultID string, credentialID string, versionID string) (*VaultCredentialVersion, error) {
	response, err := s.client.raw.ReadVaultCredentialVersionWithResponse(ctx, vaultID, credentialID, versionID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

type UsageService struct {
	client *clientCore
}

func (s UsageService) ListRecords(ctx context.Context, params *ListUsageRecordsParams) (*UsageRecordListResponse, error) {
	response, err := s.client.raw.ListUsageRecordsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s UsageService) GetRecord(ctx context.Context, recordID string) (*UsageRecord, error) {
	response, err := s.client.raw.ReadUsageRecordWithResponse(ctx, recordID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s UsageService) GetSummary(ctx context.Context, params *ReadUsageSummaryParams) (*UsageSummary, error) {
	response, err := s.client.raw.ReadUsageSummaryWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

type RunnerConfigzService struct {
	client *clientCore
}

func (s RunnerConfigzService) Get(ctx context.Context) (*PublicConfig, error) {
	response, err := s.client.raw.ReadConfigzWithResponse(ctx)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200)
}

type RunnerRunnersService struct {
	client *clientCore
}

func (s RunnerRunnersService) List(ctx context.Context, params *ListRunnersParams) (*RunnerListResponse, error) {
	response, err := s.client.raw.ListRunnersWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s RunnerRunnersService) Create(ctx context.Context, body CreateRunnerRequest) (*Runner, error) {
	response, err := s.client.raw.CreateRunnerWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON409)
}

func (s RunnerRunnersService) Get(ctx context.Context, runnerID string) (*Runner, error) {
	response, err := s.client.raw.ReadRunnerWithResponse(ctx, runnerID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s RunnerRunnersService) Update(ctx context.Context, runnerID string, body UpdateRunnerRequest) (*Runner, error) {
	response, err := s.client.raw.UpdateRunnerWithResponse(ctx, runnerID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s RunnerRunnersService) Channel(ctx context.Context, runnerID string) (JSONChannel, error) {
	return s.client.dialWebSocket(ctx, "/api/v1/runners/"+url.PathEscape(runnerID)+"/channel")
}

func (s RunnerRunnersService) GetHeartbeat(ctx context.Context, runnerID string) (*RunnerHeartbeat, error) {
	response, err := s.client.raw.ReadRunnerHeartbeatWithResponse(ctx, runnerID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s RunnerRunnersService) PutHeartbeat(ctx context.Context, runnerID string, body PutRunnerHeartbeatRequest) (*RunnerHeartbeat, error) {
	response, err := s.client.raw.PutRunnerHeartbeatWithResponse(ctx, runnerID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type RunnerWorkItemsService struct {
	client *clientCore
}

func (s RunnerWorkItemsService) List(ctx context.Context, params *ListWorkItemsParams) (*WorkItemListResponse, error) {
	response, err := s.client.raw.ListWorkItemsWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s RunnerWorkItemsService) Get(ctx context.Context, workItemID string) (*WorkItem, error) {
	response, err := s.client.raw.ReadWorkItemWithResponse(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type RunnerLeasesService struct {
	client *clientCore
}

func (s RunnerLeasesService) List(ctx context.Context, params *ListLeasesParams) (*LeaseListResponse, error) {
	response, err := s.client.raw.ListLeasesWithResponse(ctx, params)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403)
}

func (s RunnerLeasesService) Create(ctx context.Context, body CreateLeaseRequest) (*Lease, error) {
	response, err := s.client.raw.CreateLeaseWithResponse(ctx, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

func (s RunnerLeasesService) Get(ctx context.Context, leaseID string) (*Lease, error) {
	response, err := s.client.raw.ReadLeaseWithResponse(ctx, leaseID)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON401, response.JSON403, response.JSON404)
}

func (s RunnerLeasesService) Update(ctx context.Context, leaseID string, body UpdateLeaseRequest) (*Lease, error) {
	response, err := s.client.raw.UpdateLeaseWithResponse(ctx, leaseID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON200, response.JSON400, response.JSON401, response.JSON403, response.JSON404, response.JSON409)
}

type RunnerSessionsService struct {
	client *clientCore
}

func (s RunnerSessionsService) CreateEvents(ctx context.Context, sessionID string, body CreateSessionEventsRequest) (*SessionEventsAccepted, error) {
	response, err := s.client.raw.CreateSessionEventsWithResponse(ctx, sessionID, body)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func (s RunnerSessionsService) CreateRawEvents(ctx context.Context, sessionID string, events []JSON) (*SessionEventsAccepted, error) {
	body, err := json.Marshal(struct {
		Events []JSON `json:"events"`
	}{Events: events})
	if err != nil {
		return nil, err
	}
	response, err := s.client.raw.CreateSessionEventsWithBodyWithResponse(
		ctx,
		sessionID,
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	return unwrap(response.StatusCode(), response.Body, response.JSON201, response.JSON400, response.JSON401, response.JSON403, response.JSON404)
}

func unwrap[T any](status int, responseBody []byte, data *T, errors ...*ErrorResponse) (*T, error) {
	if status >= 200 && status <= 299 && data != nil {
		return data, nil
	}
	return nil, newAPIError(status, responseBody, firstError(errors...))
}

func unwrapEmpty(status int, responseBody []byte, errors ...*ErrorResponse) error {
	if status >= 200 && status <= 299 {
		return nil
	}
	return newAPIError(status, responseBody, firstError(errors...))
}

func newAPIError(status int, responseBody []byte, response *ErrorResponse) *APIError {
	if response != nil {
		return &APIError{Status: status, ResponseText: errorResponseText(response), Body: response}
	}
	return &APIError{Status: status, ResponseText: strings.TrimSpace(string(responseBody)), Body: string(responseBody)}
}

func errorResponseText(response *ErrorResponse) string {
	if response == nil {
		return ""
	}
	if response.Error.Message != "" {
		return response.Error.Message
	}
	return fmt.Sprintf("%v", response.Error)
}

func firstError(errors ...*ErrorResponse) *ErrorResponse {
	for _, err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}
