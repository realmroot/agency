import { describe, expect, it } from 'vitest'
import {
  RUNNER_PROTOCOL_SCHEMAS,
  RunnerChannelMessageSchema,
  RunnerRuntimeToolCallSchema,
  RunnerSandboxRequestSchema,
  RunnerSessionCommandSchema,
  RunnerToolCallSchema,
  RunnerWorkPayloadSchema,
  RunnerWorkspaceManifestSchema,
} from './runner-protocol'

describe('runner protocol schemas', () => {
  it('exports every OpenAPI runner protocol schema explicitly', () => {
    expect(Object.keys(RUNNER_PROTOCOL_SCHEMAS).sort()).toEqual([
      'RunnerChannelMessage',
      'RunnerGitCredential',
      'RunnerOpaqueJsonObject',
      'RunnerRuntimeRequest',
      'RunnerRuntimeToolCall',
      'RunnerSandboxRequest',
      'RunnerSessionCommand',
      'RunnerToolCall',
      'RunnerVolume',
      'RunnerVolumeMount',
      'RunnerWorkPayload',
      'RunnerWorkspaceFile',
      'RunnerWorkspaceManifest',
      'RunnerWorkspaceMount',
    ])
  })

  it('keeps session commands opaque to the runner', () => {
    const command = {
      type: 'provider.customCommand',
      nested: { bridgeOwnsThis: true },
      allowed: true,
    }
    expect(RunnerSessionCommandSchema.parse(command)).toEqual(command)
    expect(
      RunnerChannelMessageSchema.parse({
        type: 'session.command',
        sessionId: 'session_1',
        runnerId: 'runner_1',
        command,
      }),
    ).toMatchObject({ command })
    expect(RunnerSessionCommandSchema.safeParse([]).success).toBe(false)
  })

  it('keeps sandbox requests typed because the runner executes them', () => {
    expect(
      RunnerSandboxRequestSchema.parse({
        type: 'sandbox.execute',
        toolCallId: 'call_1',
        toolName: 'bash',
        input: { command: 'echo ok' },
        volumes: [
          {
            name: 'memory',
            type: 'memory',
            memoryRef: 'ama://memories/store_1',
          },
        ],
        volumeMounts: [{ name: 'memory', mountPath: '/workspace/memory', readOnly: false }],
      }),
    ).toMatchObject({ type: 'sandbox.execute', toolName: 'bash' })
    expect(RunnerSandboxRequestSchema.safeParse({ type: 'sandbox.unknown' }).success).toBe(false)
  })

  it('validates every runner channel envelope variant', () => {
    const variants = [
      { type: 'runner.channel.accepted', runnerId: 'runner_1', environmentId: 'env_1' },
      { type: 'work.assigned', runnerId: 'runner_1', lease: { id: 'lease_1' }, workItem: { id: 'work_1' } },
      { type: 'session.command', sessionId: 'session_1', command: { type: 'send', message: 'hi' } },
      { type: 'sandbox.request', requestId: 'req_1', sessionId: 'session_1', request: { type: 'sandbox.stop' } },
      { type: 'sandbox.response', requestId: 'req_1', sessionId: 'session_1', ok: true, result: { ok: true } },
      { type: 'sandbox.response', requestId: 'req_1', sessionId: 'session_1', ok: false, error: 'failed' },
      { type: 'session.backfill_request', eventId: 'evt_1', sessionId: 'session_1' },
      {
        type: 'session.backfill_response',
        eventId: 'evt_1',
        sessionId: 'session_1',
        events: [{ id: 'evt_1' }],
        error: 'partial',
      },
      {
        type: 'runner.event',
        sessionId: 'session_1',
        record: { id: 'evt_1', type: 'message.completed', payload: {} },
      },
      { type: 'runner.event.accepted', eventId: 'evt_1' },
      { type: 'session.channel.error', eventId: 'evt_1', message: 'failed' },
      { type: 'session.channel.error', message: 'failed' },
    ]
    for (const variant of variants) {
      expect(RunnerChannelMessageSchema.safeParse(variant).success, variant.type).toBe(true)
    }
  })

  it('rejects malformed runner channel envelopes', () => {
    expect(RunnerChannelMessageSchema.safeParse({ type: 'session.command', command: { type: 'send' } }).success).toBe(
      false,
    )
    expect(
      RunnerChannelMessageSchema.safeParse({ type: 'sandbox.request', requestId: 'req_1', sessionId: 'session_1' })
        .success,
    ).toBe(false)
    expect(
      RunnerChannelMessageSchema.safeParse({ type: 'runner.event', sessionId: 'session_1', record: [] }).success,
    ).toBe(false)
    expect(RunnerChannelMessageSchema.safeParse({ type: 'runner.event.accepted' }).success).toBe(false)
    expect(RunnerChannelMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false)
  })

  it('requires stable tool call ids and names where the runner must execute tools', () => {
    expect(
      RunnerToolCallSchema.safeParse({ id: 'call_1', name: 'bash', input: { command: 'ls' }, approved: true }).success,
    ).toBe(true)
    expect(
      RunnerRuntimeToolCallSchema.safeParse({ id: 'call_1', name: 'bash', arguments: { command: 'ls' } }).success,
    ).toBe(true)
    expect(RunnerToolCallSchema.safeParse({ name: 'bash', input: {} }).success).toBe(false)
    expect(RunnerRuntimeToolCallSchema.safeParse({ id: 'call_1', input: {} }).success).toBe(false)
  })

  it('validates work payloads and workspace manifests at the runner boundary', () => {
    expect(
      RunnerWorkspaceManifestSchema.parse({
        root: '/workspace',
        mounts: [
          {
            name: 'source',
            type: 'git_repository',
            mountPath: '/workspace/source',
            url: 'https://github.com/saltbo/slink.git',
            ref: 'main',
            credential: { username: 'x-access-token', password: 'secret' },
            files: [{ path: 'README.md', content: 'hello' }],
          },
        ],
      }),
    ).toMatchObject({ root: '/workspace' })
    expect(
      RunnerWorkPayloadSchema.safeParse({
        protocol: 'ama-runner-work',
        type: 'session.start',
        sessionId: 'session_1',
        hostingMode: 'self_hosted',
        runtime: 'codex',
        runtimeConfig: { provider: 'codex' },
        provider: 'codex',
        model: 'gpt',
        agentSnapshot: { metadata: { uid: 'agent_1' } },
        runtimeDriver: 'codex-self-hosted',
        runtimeRequirement: { runtime: 'codex', model: 'gpt' },
        env: { HOME: '/tmp' },
        workspaceManifest: { root: '/workspace', mounts: [] },
        prompt: 'build',
        resume: false,
      }).success,
    ).toBe(true)
  })
})
