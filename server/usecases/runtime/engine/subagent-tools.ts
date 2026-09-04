import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  enborOrchestrationToolInputJsonSchema,
  parseEnborOrchestrationToolInput,
} from '@enbor/runtime-contracts/tool-contracts'
import type { SessionSubagentSnapshot } from '@server/domain/session'
import { RuntimePolicyDeniedError, RuntimeTurnCancelledError } from './errors'
import type { TurnEngineInput, TurnEngineResult } from './ports'

export function subagentTools(
  parent: TurnEngineInput,
  run: (input: TurnEngineInput) => Promise<TurnEngineResult>,
  signal: AbortSignal,
  pause: () => void = () => {},
): AgentTool[] {
  const children = parent.agentSnapshot.subagents as SessionSubagentSnapshot[] | undefined
  if (!children?.length) return []
  return [
    {
      name: 'agent',
      label: 'Run subagent',
      description: `Delegate a task to a configured subagent. Set subagentName to one of: ${children.map((child) => child.name).join(', ')}.`,
      parameters: enborOrchestrationToolInputJsonSchema('agent') as AgentTool['parameters'],
      executionMode: 'sequential',
      async execute(toolCallId, params) {
        const input = parseEnborOrchestrationToolInput('agent', params)
        const child = children.find((candidate) => candidate.name === input.subagentName)
        if (!child) throw new Error(`Unknown configured subagent: ${input.subagentName ?? '(missing)'}`)
        if (signal.aborted) throw new RuntimeTurnCancelledError()
        await parent.liveness.ensureActive()
        const decision = await parent.policy.approve({ toolCallId, toolName: 'agent', input })
        if (!decision.allowed)
          throw new RuntimePolicyDeniedError(decision.reason ?? 'Subagent blocked by Session policy')
        const supplied = await parent.toolResults.resolve({ toolCallId, toolName: 'agent', input })
        if (supplied) return { content: [{ type: 'text', text: JSON.stringify(supplied) }], details: supplied }
        const modelId = child.model ?? parent.modelLabel
        const model = modelId === parent.modelLabel ? parent.model : parent.resolveModel?.(modelId)
        if (!model) throw new Error(`Subagent model cannot be resolved: ${modelId}`)
        const messages = parent.subagentMessages?.[toolCallId]
        const lastMessage = messages?.at(-1)
        if (lastMessage?.role === 'assistant' && lastMessage.stopReason === 'stop') {
          const content = lastMessage.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
          return { content: [{ type: 'text', text: content }], details: { subagentName: child.name, content } }
        }
        if (parent.budget?.shouldPause()) {
          pause()
          throw new RuntimeTurnCancelledError()
        }
        let output = ''
        const result = await run({
          sessionId: parent.sessionId,
          sandboxId: parent.sandboxId,
          model,
          ...(parent.resolveModel ? { resolveModel: parent.resolveModel } : {}),
          modelLabel: modelId,
          providerLabel: child.provider ?? parent.providerLabel,
          agentSnapshot: {
            systemPrompt: child.systemPrompt,
            allowedTools: child.allowedTools,
            skills: child.skills,
            mcpConnectors: child.mcpConnectors,
          },
          ...(messages?.length ? { messages, continuation: true } : { prompt: input.prompt }),
          ...(parent.budget ? { budget: parent.budget } : {}),
          policy: parent.policy,
          toolResults: parent.toolResults,
          liveness: parent.liveness,
          executor: parent.executor,
          modelClient: parent.modelClient,
          signal,
          sink: {
            async emit(event) {
              if (
                event.type === 'message.started' ||
                event.type === 'message.updated' ||
                event.type === 'message.completed'
              ) {
                const message = event.payload.message
                if (event.type === 'message.completed' && message.role === 'assistant') {
                  output = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
                }
                await parent.sink.emit({ ...event, payload: { message: { ...message, parentToolCallId: toolCallId } } })
              } else if (event.type === 'usage.recorded') {
                await parent.sink.emit(event)
              }
            },
          },
        })
        if (result.status === 'paused') pause()
        if (result.status !== 'idle') throw new RuntimeTurnCancelledError()
        return { content: [{ type: 'text', text: output }], details: { subagentName: child.name, content: output } }
      },
    },
  ]
}
