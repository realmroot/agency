import { createBrowserRouter, Navigate, useParams } from 'react-router'
import { AgentBuilderPage } from '@/features/agents/AgentBuilderPage'
import { AgentDetailPage } from '@/features/agents/AgentDetailPage'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { AuditPage } from '@/features/audit/AuditPage'
import { AuditRecordPage } from '@/features/audit/AuditRecordPage'
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage'
import { ConsoleLayout } from '@/features/console/ConsoleLayout'
import { EnvironmentDetailPage } from '@/features/environments/EnvironmentDetailPage'
import { EnvironmentsPage } from '@/features/environments/EnvironmentsPage'
import { McpConnectorPage } from '@/features/mcp/McpConnectorPage'
import { McpPage } from '@/features/mcp/McpPage'
import { MemoryStoreDetailPage } from '@/features/memory-stores/MemoryStoreDetailPage'
import { MemoryStoresPage } from '@/features/memory-stores/MemoryStoresPage'
import { ProvidersPage } from '@/features/providers/ProvidersPage'
import { SessionDetailPage } from '@/features/sessions/SessionDetailPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TriggersPage } from '@/features/triggers/TriggersPage'
import { UsagePage } from '@/features/usage/UsagePage'
import { VaultDetailPage } from '@/features/vaults/VaultDetailPage'
import { VaultsPage } from '@/features/vaults/VaultsPage'

function LegacyMcpConnectorRedirect() {
  const { connectorId } = useParams()
  return <Navigate to={`/settings/mcp/${connectorId ?? ''}`} replace />
}

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: '/auth/callback',
      element: <AuthCallbackPage />,
    },
    {
      path: '/',
      element: <ConsoleLayout />,
      children: [
        { index: true, element: <Navigate to="/agents" replace /> },
        { path: 'agents', element: <AgentsPage /> },
        { path: 'agents/new', element: <AgentBuilderPage /> },
        { path: 'agents/:agentId', element: <AgentDetailPage /> },
        { path: 'environments', element: <EnvironmentsPage /> },
        { path: 'environments/:environmentId', element: <EnvironmentDetailPage /> },
        { path: 'sessions', element: <SessionsPage /> },
        { path: 'sessions/:sessionId', element: <SessionDetailPage /> },
        { path: 'triggers', element: <TriggersPage /> },
        { path: 'providers', element: <Navigate to="/settings/providers" replace /> },
        { path: 'vaults', element: <VaultsPage /> },
        { path: 'vaults/:vaultId', element: <VaultDetailPage /> },
        { path: 'memory-stores', element: <MemoryStoresPage /> },
        { path: 'memory-stores/:storeId', element: <MemoryStoreDetailPage /> },
        { path: 'mcp', element: <Navigate to="/settings/mcp" replace /> },
        { path: 'mcp/:connectorId', element: <LegacyMcpConnectorRedirect /> },
        { path: 'usage', element: <UsagePage /> },
        { path: 'audit', element: <AuditPage /> },
        { path: 'audit/:recordId', element: <AuditRecordPage /> },
        {
          path: 'settings',
          element: <SettingsPage />,
          children: [
            { index: true, element: <Navigate to="/settings/providers" replace /> },
            { path: 'providers', element: <ProvidersPage /> },
            { path: 'mcp', element: <McpPage /> },
            { path: 'mcp/:connectorId', element: <McpConnectorPage /> },
          ],
        },
        { path: '*', element: <Navigate to="/agents" replace /> },
      ],
    },
  ])
}
