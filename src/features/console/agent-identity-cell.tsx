import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceIdentityCell } from '@/console/components'

export function AgentIdentityCell({
  agentId,
  agentName,
  provider,
  model,
}: {
  agentId: string
  agentName?: string | undefined
  provider?: string | null | undefined
  model?: string | null | undefined
}) {
  const displayName = agentName ?? agentId
  const providerModel = `${provider ?? 'None'} / ${model ?? 'None'}`
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${displayName} ${agentId}. Provider/model: ${providerModel}`}
            className="w-full min-w-0 cursor-help border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ResourceIdentityCell name={displayName} id={agentId} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-normal break-words">{providerModel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
