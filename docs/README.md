# Documentation

The repository documentation is organized by purpose:

- [`guides/`](guides/) contains non-normative developer guides for adopting
  and integrating Enbor.
- [`adr/`](adr/) records accepted architecture decisions, their context, and
  their consequences.
- [`infra/`](infra/) contains deployment and operational guidance.

SDK installation, authentication, and usage examples live under
[`../sdk/`](../sdk/).

Installable Agent-facing operating instructions live in the repository-level
[`skills/`](../skills/) directory.

## Normative content ownership

- Product and API behavior belongs exclusively in Gherkin under
  [`../spec/`](../spec/).
- Exact API paths, methods, schemas, and examples belong in route schemas and
  the generated [`../sdk/openapi.json`](../sdk/openapi.json).
- Markdown must not contain product specifications, API design specifications,
  endpoint catalogs, or normative request and response documentation.
- ADRs explain why consequential architecture choices were made. Contributor
  guides explain development workflow. Infrastructure documents are operational
  runbooks. None of them may become a second source of product behavior.
- When normative behavior is found in Markdown, migrate it into the owning
  `.feature` file and remove the Markdown version in the same change.
