export type WorkspaceVolumeManifest = {
  version: 1
  workspaceRoot: string
  volumes: WorkspaceVolume[]
}

export type WorkspaceVolume =
  | {
      type: 'git_repository'
      name: unknown
      url: unknown
      mountPath: unknown
      ref?: string
      status: 'declared'
    }
  | {
      type: 'memory'
      memoryRef: unknown
      name: unknown
      mountPath: unknown
      status: 'declared'
    }
  | {
      type: 'secret'
      name: unknown
      mountPath: unknown
      files: Array<{ path: unknown }>
      status: 'declared'
    }
