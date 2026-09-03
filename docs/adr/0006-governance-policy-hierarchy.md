# 0006: Governance policy hierarchy

- Status: Accepted
- Date: 2026-06-12

## Context

Governance policy can be declared by an organization, one or more asserted
teams, and a project. Evaluation must be deterministic and must not allow a
narrower scope to weaken a broader restriction.

## Decision

- Governance policy is hierarchical across organization, asserted team, and
  project ownership.
- Effective resolution is deterministic and monotonic: a narrower scope cannot
  weaken a broader restriction.
- AMA consumes team identity from the configured OIDC provider rather than
  maintaining a competing team directory.
- Historical execution evidence remains immutable while policy evaluation uses
  the current effective policy.

Observable merge and enforcement behavior is specified in
`spec/governance.feature`.

## Consequences

- Policy evaluation is stable regardless of claim ordering.
- A narrower scope cannot relax an explicit broader restriction.
- AMA relies on team claims from the configured OIDC provider instead of
  duplicating team ownership.
- Historical evidence remains intact while future work observes current policy.
