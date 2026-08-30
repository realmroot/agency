import { v7 as uuidv7 } from 'uuid'

export function newPrimaryKey(): string {
  return uuidv7()
}
