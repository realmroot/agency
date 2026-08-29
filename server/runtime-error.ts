export interface SafeRuntimeError {
  type: 'runtime_error'
  message: string
  code?: string
  detail?: Record<string, string>
}

const MAX_RUNTIME_DIAGNOSTIC_LENGTH = 2_000

function safeDiagnostic(value: string) {
  return value
    .replaceAll(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replaceAll(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [redacted]')
    .replaceAll(/\b(token|secret|password|api[_-]?key)=([^\s]+)/gi, '$1=[redacted]')
    .slice(0, MAX_RUNTIME_DIAGNOSTIC_LENGTH)
}

export class EnvironmentPackageInstallationError extends Error {
  readonly code = 'environment_package_installation_failed'
  readonly step: string
  readonly diagnostic: string | undefined

  constructor(step: string, diagnostic?: string, options?: ErrorOptions) {
    super(`Environment package installation failed at ${step}`, options)
    this.name = 'EnvironmentPackageInstallationError'
    this.step = step
    this.diagnostic = diagnostic ? safeDiagnostic(diagnostic) : undefined
  }
}

export function safeRuntimeError(error: unknown): SafeRuntimeError {
  if (error instanceof EnvironmentPackageInstallationError) {
    return {
      type: 'runtime_error',
      message: error.message,
      code: error.code,
      detail: {
        step: error.step,
        ...(error.diagnostic ? { stderr: error.diagnostic } : {}),
      },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error) {
    return {
      type: 'runtime_error',
      message,
      ...(error.name ? { code: error.name } : {}),
    }
  }
  return { type: 'runtime_error', message }
}
