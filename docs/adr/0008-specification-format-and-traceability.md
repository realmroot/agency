# 0008: Specification format and traceability

- Status: Accepted
- Date: 2026-05-22

## Context

Product behavior needs a readable source of truth and a stable link to the
cheapest executable proof without introducing a second test runner or mixing
test implementation into product specifications.

## Decision

- Gherkin is the product specification format.
- `.feature` files under `spec/` are documentation and traceability sources, not
  executable Cucumber suites.
- Every enforced scenario has a stable id and one owning proof layer.
- Native tests include `[spec: <id>]` breadcrumbs. Browser journeys use native
  Playwright tests rather than generated step definitions.

## Consequences

- Product behavior stays readable independently of test framework details.
- Test implementation can use the cheapest appropriate layer.
- Repository linting can detect enforced scenarios that have lost executable
  proof.
- Scenario ids are durable references and must not be casually renamed.
