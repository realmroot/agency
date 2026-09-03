export function normalizeGitRepositoryUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    return null
  }
  const path = parsed.pathname.split('/').filter(Boolean)
  if (path.length < 2 || path.some((segment) => segment === '.' || segment === '..')) {
    return null
  }
  for (const segment of path) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (!/^[A-Za-z0-9._~-]+$/.test(decoded)) {
      return null
    }
  }
  parsed.search = ''
  parsed.pathname = `/${path.join('/')}`
  return parsed.toString()
}

export function gitRepositoryMountPath(url: string): string {
  const parsed = new URL(url)
  const path = parsed.pathname
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean)
    .join('/')
  return `/workspace/repos/${parsed.hostname}/${path}`
}

export function gitCredentialEnvName(volumeName: string): string {
  const safeName = volumeName.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()
  return `ENBOR_GIT_TOKEN_${safeName}`
}
