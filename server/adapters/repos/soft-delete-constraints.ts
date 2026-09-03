import { ResourceDeletedDuringMutationError } from '@server/usecases/ports'

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
