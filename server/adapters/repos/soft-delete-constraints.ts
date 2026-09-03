import { ResourceDeletedDuringMutationError, RunnerConflictError } from '@server/usecases/ports'

function causedByDeletedRunnerEnvironment(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message.includes('cannot attach a live runner to a deleted environment')) return true
  return causedByDeletedRunnerEnvironment(error.cause)
}

function causedByDeletedParent(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (
    error.message.includes('cannot attach a live resource to a deleted project') ||
    error.message.includes('cannot attach a live memory to a deleted memory store') ||
    error.message.includes('cannot dispatch a deleted trigger')
  ) {
    return true
  }
  return causedByDeletedParent(error.cause)
}

export function throwIfDeletedParentConstraint(error: unknown, resourceType: string): void {
  if (causedByDeletedParent(error)) throw new ResourceDeletedDuringMutationError(resourceType)
}

export function throwIfDeletedRunnerEnvironmentConstraint(error: unknown): void {
  if (causedByDeletedRunnerEnvironment(error)) throw new RunnerConflictError('Runner environment is unavailable')
}
