import { describe, expect, it } from 'vitest'
import { gitCredentialEnvName, gitRepositoryMountPath, normalizeGitRepositoryUrl } from './git-repository'

describe('[spec: sessions/workspace-volumes] git repository domain helpers', () => {
  it('normalizes safe https repository urls', () => {
    expect(normalizeGitRepositoryUrl(' https://github.com/saltbo/slink.git?token=ignored ')).toBe(
      'https://github.com/saltbo/slink.git',
    )
    expect(normalizeGitRepositoryUrl('https://github.com/org/repo/subpath')).toBe('https://github.com/org/repo/subpath')
  })

  it('rejects unsafe repository urls', () => {
    expect(normalizeGitRepositoryUrl('not a url')).toBeNull()
    expect(normalizeGitRepositoryUrl('http://github.com/org/repo')).toBeNull()
    expect(normalizeGitRepositoryUrl('https://user:pass@github.com/org/repo')).toBeNull()
    expect(normalizeGitRepositoryUrl('https://github.com/org/repo#main')).toBeNull()
    expect(normalizeGitRepositoryUrl('https://github.com/org')).toBeNull()
    expect(normalizeGitRepositoryUrl('https://github.com/org/../repo')).toBeNull()
    expect(normalizeGitRepositoryUrl('https://github.com/org/repo%2Fbad')).toBeNull()
    expect(normalizeGitRepositoryUrl('https://github.com/org/%E0%A4%A')).toBeNull()
  })

  it('derives stable mount paths and credential env names', () => {
    expect(gitRepositoryMountPath('https://github.com/saltbo/slink.git')).toBe(
      '/workspace/repos/github.com/saltbo/slink',
    )
    expect(gitCredentialEnvName('main-repo.1')).toBe('ENBOR_GIT_TOKEN_MAIN_REPO_1')
  })
})
