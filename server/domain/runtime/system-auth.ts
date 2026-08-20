// Pure system-identity builders for the runtime data plane. They synthesize an
// AuthScope from plain ids for the cloud-turn queue path and the runner session
// channel, so policy evaluation and event audit have an authenticated caller
// without an http request. No I/O, no deps — pure leaf shaping. The returned
// literals are structurally AuthScope; the type is not imported so domain stays
// dependency-free.

export function cloudTurnSystemAuth(message: { organizationId: string; projectId: string }) {
  return {
    user: { id: 'system:cloud-turn' },
    organization: { id: message.organizationId, name: message.organizationId },
    project: { id: message.projectId, name: message.projectId },
    roles: ['system'],
    permissions: ['*'],
  }
}

// Channel-scoped system identity for policy evaluation and event audit on
// runner-ingested permission requests.
export function channelSystemAuth(state: { organizationId: string; projectId: string; runnerId: string }) {
  return {
    user: { id: 'system:runner-channel', email: '', name: 'AMA runner channel', avatarUrl: null },
    organization: { id: state.organizationId, name: state.organizationId },
    project: { id: state.projectId, name: state.projectId },
    roles: ['system'],
    permissions: ['*'],
    oidc: {
      subject: 'system:runner-channel',
      clientId: null,
      scope: null,
      issuer: null,
      runnerId: state.runnerId,
    },
  }
}
