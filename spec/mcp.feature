Feature: MCP
  Platform MCP connectors are a static catalog of MCP servers. Enbor does not
  expose a connection resource, does not bind credentials to connectors, and
  does not proxy MCP tool calls.

  # ── Connector catalog (domain: static directory, no tenancy) ──

  @mcp/catalog @domain
  Scenario: Expose a static connector catalog
    Given the platform seeds a connector catalog
    Then every entry is available, carries at least one tool, and declares its supported auth modes
    And connectors that need a credential require a vault credential auth mode

  # ── Discovery (api: assembled server, catalog browsing) ──

  @mcp/discovery @api
  Scenario: Browse, search, filter, and inspect the connector catalog
    Given the platform has a connector catalog
    When the user searches and filters connectors by name, category, capability, trust level, and availability
    Then results match the criteria and expose id, category, trust level, supported auth modes, and tools
    And reading a single connector returns its detail and unknown ids return not found
    And the same static catalog is served to every tenant without requiring credentials

  # ── Contract (api: OpenAPI) ──

  @mcp/openapi @api
  Scenario: Publish connector routes in OpenAPI
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the connector catalog paths
    And it does not include connection, connection tool, or MCP tool-call paths
    And the legacy /api/mcp namespace is gone
