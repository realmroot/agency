# Choosing an Enbor Integration Path

Enbor has several developer and Agent-facing interfaces. They are complementary,
not interchangeable. This guide explains which interface owns each part of an
integration without duplicating the normative product contract.

## The Short Version

| Need | Use | Why |
| --- | --- | --- |
| Understand Enbor or find an integration example | Context7 library `/realmroot/enbor` | Retrieves relevant project and SDK documentation |
| Build Enbor into an application | TypeScript, Go, or Python SDK | Provides typed application APIs |
| Ask an Agent to inspect or change live Enbor resources | `operate-enbor` Skill | Gives the Agent the required operating policy |
| Authenticate, discover current operations, and execute them | Realmroot Toolbox | Uses Agent identity and the live Enbor contract |
| Inspect exact paths and schemas | Generated OpenAPI document | Remains the exact API contract |

Context7 answers “what is Enbor and how should I integrate it?” The Skill
answers “how must an Agent safely operate Enbor?” Realmroot Toolbox performs the
operation.

```text
Question or task
      |
      +-- Learn or write application code
      |      Context7 -> SDK guide -> SDK
      |
      +-- Read or change a live Enbor deployment
             Enbor Skill -> Realmroot Toolbox -> live OpenAPI operation
```

## Use Context7 for Knowledge

Context7 indexes the Enbor overview, adoption guides, SDK guides, and the
`operate-enbor` Skill. Use library id `/realmroot/enbor` for questions such
as:

- What problem does Enbor solve?
- When should a product use an Agent, Environment, or Session?
- How do I create a Session with the TypeScript SDK?
- Should this workflow use an SDK or the Enbor Skill?

Context7 does not connect to an Enbor deployment, acquire Enbor authority, or
run an operation. Code returned by Context7 is application integration guidance,
not permission to mutate a live resource.

An Agent prompt can make the source explicit:

```text
Use Context7 library /realmroot/enbor to explain the recommended TypeScript SDK
flow for creating an Agent and starting a Session.
```

## Use an SDK in Application Code

Use an SDK when Enbor is part of a service, CLI, browser application, or other
maintained codebase. The embedding application owns its credential lifecycle
and calls the stable resource facade described in the language guide:

- [TypeScript SDK](../../sdk/typescript/README.md)
- [Go SDK](../../sdk/go/README.md)
- [Python SDK](../../sdk/python/README.md)

Use Context7 to retrieve the relevant SDK example while writing code. Use the
generated [OpenAPI document](../../sdk/openapi.json) when exact schemas are
required.

## Use the Skill for Agent-Operated Enbor

Use the `operate-enbor` Skill when the user asks an Agent to perform
an outcome against a live Enbor deployment, such as inspecting Agents, starting
a Session, or checking its resulting state.

Install the Skill from the public Enbor deployment for Codex:

```bash
npx skills add https://enbor.realmroot.dev \
  --skill operate-enbor \
  --agent codex \
  --global
```

For a self-hosted deployment, replace the origin with that deployment's origin.
The Skill is an operating contract for the Agent. It requires Agent identity,
minimum controller-approved authority, identifier verification before mutation,
and post-operation verification.

Ask for the outcome rather than embedding guessed API commands:

```text
Use the operate-enbor Skill to list the Agents in the selected Enbor
Project.
```

```text
Use the operate-enbor Skill to start a Session for this Agent and
verify the resulting Session state.
```

## Toolbox Is the Live Execution Layer

The Skill drives Realmroot Toolbox. Toolbox discovers the protected Enbor
Resource, the current OpenAPI contract, available Contexts, and required scopes.
Its starting workflow is:

```bash
realmroot toolbox sync enbor
realmroot toolbox enbor --search '<requested capability>'
realmroot toolbox enbor context
```

After discovery, use the exact command and request shape printed by Toolbox.
Do not copy operation names into durable documentation or infer them from an old
Context7 result. This keeps live automation aligned with the deployed Enbor
version and prevents documentation from becoming a second API contract.

## Use Both for End-to-End Work

A task can legitimately use both paths:

1. Query `/realmroot/enbor` through Context7 to understand the resource model
   and retrieve the relevant SDK pattern.
2. Implement and verify the application code locally.
3. Load the `operate-enbor` Skill before touching a live deployment.
4. Let Toolbox discover the current operation and request only the required
   authority.
5. Execute the operation and read the affected resource again to verify it.

The handoff between steps 2 and 3 is the important boundary: Context7 helps
produce correct code and plans; the Skill and Toolbox govern live execution.

## Sources of Truth

- Product behavior: [`spec/*.feature`](../../spec/)
- Exact API shape: [generated OpenAPI](../../sdk/openapi.json)
- Application usage: [SDK guides](../../sdk/README.md)
- Agent operating policy: [`operate-enbor` Skill](../../skills/operate-enbor/SKILL.md)
- Task-relevant retrieval: Context7 library `/realmroot/enbor`
