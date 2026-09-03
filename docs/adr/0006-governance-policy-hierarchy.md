# 0006: Governance policy hierarchy

- Status: Accepted
- Date: 2026-06-12

## Context

Governance policy can be declared by an organization, one or more asserted
teams, and a project. Evaluation must be deterministic and must not allow a
narrower scope to weaken a broader restriction.

## Decision

- Governance policy rows exist at `organization`, `team`, and `project` scope.
  Team scope binds to an OIDC-asserted team id; AMA stores no local team tables.
  A team policy applies only when the caller's OIDC `teams` claim includes that
  team id.
- Effective policy is a deterministic, most-restrictive merge ordered
  organization, teams sorted by team id, then project. One row per scope and
  team participates; the latest `updatedAt` wins.
- Merge rules are:
  - `providerRules` and `modelRules` concatenate; any applicable deny rule
    denies.
  - `blocked*`, `denied*`, and `requireApproval*` lists form a union.
  - `allowed*` lists intersect across scopes that define them; `'*'` is the
    intersection identity, and an undefined allow list adds no constraint.
  - `defaultEffect: 'deny'` is sticky.
  - Boolean flags use logical AND, so `false` is sticky.
  - Restrictive string states such as `disabled`, `deny`, and `offline` are
    sticky once set by a broader scope.
  - Numeric limits take the minimum.
  - Nested objects shallow-merge with the most specific scope last; any other
    scalar takes the most specific value.
- Governance and budget data is managed through public `/api/v1` CRUD resources.
  The removed `/api/governance/*` import, preview, and validate surface is not
  part of v1.
- A referenced team is known when declared in a configuration document's
  `teams` section or asserted by the submitting operator's OIDC `teams` claim.
- Historical Sessions retain immutable Agent and Environment snapshots and
  recorded events after policy changes. New runtime work on any Session is
  evaluated against current effective policy.

## Consequences

- Policy evaluation is stable regardless of claim ordering.
- A narrower scope cannot relax an explicit broader restriction.
- AMA relies on team claims from the configured OIDC provider instead of
  duplicating team ownership.
- Historical evidence remains intact while future work observes current policy.
