Feature: Quickstart
  A first-run guided flow walks a developer from an empty project to a running
  session: a stepper for provider, environment, agent, session, and integration
  that starts on a usable workflow, shows the API call made at each step against
  the current platform origin, and ends with secret-free integration examples.

  # ── Step sequencing (web: completion derived from real resource state) ──

  @quickstart/step-sequencing @web
  Scenario: Sequence quickstart steps from real resource state
    Given the project has some but not all of provider, environment, agent, and session
    When quickstart derives completion and unlocking
    Then completed steps and the next incomplete step unlock while later steps stay locked
    And the flow opens on the first incomplete step rather than a marketing page

  @quickstart/environment-input @web
  Scenario: Configure the execution environment in quickstart
    Given the developer is on the environment step
    When the developer chooses unrestricted or limited networking
    Then unrestricted networking creates a cloud environment
    And limited networking captures allowed hosts, MCP access, and package-manager access

  @quickstart/sandbox-addon @web
  Scenario: Add sandbox execution to the quickstart agent
    Given an agent was created in quickstart
    When the developer enables sandbox access
    Then sandbox tools are added and the coding-agent skill is carried consistently with the agent schema

  @quickstart/integration-examples @web
  Scenario: Show secret-free integration examples after a session
    Given quickstart has created an agent, environment, and session
    When the developer opens the integration step
    Then the Realmroot Toolbox example targets the protected AMA Resource with the created resource ids
    And live traffic uses AMA session endpoints and examples never embed secrets or vendor URLs

  # ── First-run flow (web: guided console journey) ──

  @quickstart/first-run @web
  Scenario: Complete the first-run flow from an empty project
    Given a developer opens the console for the first time
    When the developer creates an environment, an agent, and a session and sends the first prompt
    Then the quickstart stepper shows provider, environment, agent, session, and integration with the API call per step
    And the session streams runtime events into the preview without a page reload
