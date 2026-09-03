import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSelectedProjectId, getSelectedProjectId, setSelectedProjectId } from './project-selection'

describe('project-selection', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('returns null when no project id is set', () => {
    window.localStorage.clear()
    expect(getSelectedProjectId()).toBeNull()
  })

  it('returns the stored project id', () => {
    window.localStorage.setItem('enbor:selected-project-id', 'proj_abc')
    expect(getSelectedProjectId()).toBe('proj_abc')
  })

  it('stores a project id in localStorage', () => {
    setSelectedProjectId('proj_xyz')
    expect(window.localStorage.getItem('enbor:selected-project-id')).toBe('proj_xyz')
  })

  it('dispatches enbor:selected-project-changed event when setting project id', () => {
    const received: CustomEvent[] = []
    window.addEventListener('enbor:selected-project-changed', (e) => received.push(e as CustomEvent))
    setSelectedProjectId('proj_dispatch')
    expect(received).toHaveLength(1)
    expect(received[0]?.detail).toEqual({ projectId: 'proj_dispatch' })
    window.removeEventListener('enbor:selected-project-changed', (e) => received.push(e as CustomEvent))
  })

  it('removes the project id from localStorage on clear', () => {
    window.localStorage.setItem('enbor:selected-project-id', 'proj_to_remove')
    clearSelectedProjectId()
    expect(window.localStorage.getItem('enbor:selected-project-id')).toBeNull()
  })

  it('dispatches enbor:selected-project-changed with null on clear', () => {
    const received: CustomEvent[] = []
    const handler = (e: Event) => received.push(e as CustomEvent)
    window.addEventListener('enbor:selected-project-changed', handler)
    clearSelectedProjectId()
    expect(received).toHaveLength(1)
    expect(received[0]?.detail).toEqual({ projectId: null })
    window.removeEventListener('enbor:selected-project-changed', handler)
  })
})
