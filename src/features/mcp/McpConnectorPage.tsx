import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { DetailSection, EmptyState, Meta, MetaGrid, PageHeader, StatusBadge } from '@/console/components'
import { ApiError, api, type Connector } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { connectorDisabledReason } from './McpView'

export function McpConnectorPage() {
  const { connectorId } = useParams()
  const connectorQuery = useQuery({
    queryKey: queryKeys.connectors.detail(connectorId ?? ''),
    queryFn: () => api.readConnector(connectorId as string),
    enabled: Boolean(connectorId),
  })
  const connector = connectorQuery.data ?? null

  if (connectorQuery.error instanceof ApiError && connectorQuery.error.status === 404) {
    return (
      <EmptyState
        title="Connector not found"
        body={`No MCP connector named "${connectorId}" exists in the catalog.`}
        action={
          <Link to="/settings/mcp" className={buttonVariants({ variant: 'outline' })}>
            Back to MCP discovery
          </Link>
        }
      />
    )
  }
  if (connectorQuery.error) {
    return (
      <EmptyState
        title="Connector unavailable"
        body={connectorQuery.error instanceof Error ? connectorQuery.error.message : String(connectorQuery.error)}
      />
    )
  }
  if (connectorQuery.isPending || !connector) {
    return <EmptyState title="Loading connector" body="Reading connector catalog entry." />
  }

  const disabledReason = connectorDisabledReason(connector)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="MCP connector"
        title={connector.name}
        titleAccessory={<StatusBadge value={connector.availability} detail={disabledReason} />}
        description={connector.description}
      />
      {disabledReason ? <p className="text-sm text-destructive">{disabledReason}</p> : null}
      <DetailSection title="Connector profile" description={connector.id}>
        <MetaGrid>
          <Meta label="Category" value={connector.category} />
          <Meta label="Trust level" value={connector.trustLevel} />
          <Meta label="Capabilities" value={connector.capabilities.join(', ') || 'None'} />
          <Meta label="Supported auth modes" value={connector.supportedAuthModes.join(', ') || 'None'} />
          <Meta label="Required credential type" value={requiredCredentialType(connector)} />
          <Meta label="Catalog status" value={connector.availability} />
        </MetaGrid>
      </DetailSection>
      <DetailSection
        title="Setup instructions"
        description="Credentials stay in a project vault; the catalog never asks for raw secret values."
      >
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {setupInstructions(connector).map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ol>
      </DetailSection>
      <DetailSection title="Tools" description="Tool contracts captured from the catalog or the live MCP server.">
        {connector.tools.length === 0 ? (
          <p className="text-sm text-muted-foreground">This connector does not declare catalog tools.</p>
        ) : (
          <MetaGrid>
            {connector.tools.map((tool) => (
              <Meta
                key={tool.name}
                label={tool.name}
                value={`${tool.description ?? 'No description'} (approval: ${tool.approvalMode})`}
              />
            ))}
          </MetaGrid>
        )}
      </DetailSection>
    </div>
  )
}

function requiredCredentialType(connector: Connector) {
  if (!connector.supportedAuthModes.includes('vault_credential')) {
    return 'None'
  }
  return connector.setupRequirements.join(', ') || 'vault_credential'
}

function setupInstructions(connector: Connector) {
  const instructions: string[] = []
  if (connector.supportedAuthModes.includes('vault_credential')) {
    for (const requirement of connector.setupRequirements) {
      instructions.push(`Store a ${requirement} credential in a project vault.`)
    }
    instructions.push('Connect the connector with the vault secret reference.')
  } else {
    instructions.push('Connect the connector; no credential is required.')
  }
  instructions.push('Allow the connector for agents and environments that should call its tools.')
  return instructions
}
