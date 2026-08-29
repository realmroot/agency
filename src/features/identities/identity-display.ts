import type { Identity } from '@/lib/amarpc'

export function identityStatusLabel(identity: Identity) {
  if (identity.metadata.archivedAt) return 'Archived'
  switch (identity.status.state) {
    case 'provisioning':
      return 'Creating'
    case 'active':
      return 'Active'
    case 'error':
      return 'Needs attention'
  }
}

export function identityAssignmentLabel(identity: Identity) {
  return identity.status.boundAgentId ? 'Assigned' : 'Unassigned'
}
