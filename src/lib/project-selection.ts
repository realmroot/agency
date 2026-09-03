const SELECTED_PROJECT_KEY = 'enbor:selected-project-id'

export function getSelectedProjectId() {
  return window.localStorage.getItem(SELECTED_PROJECT_KEY)
}

export function setSelectedProjectId(projectId: string) {
  window.localStorage.setItem(SELECTED_PROJECT_KEY, projectId)
  window.dispatchEvent(new CustomEvent('enbor:selected-project-changed', { detail: { projectId } }))
}

export function clearSelectedProjectId() {
  window.localStorage.removeItem(SELECTED_PROJECT_KEY)
  window.dispatchEvent(new CustomEvent('enbor:selected-project-changed', { detail: { projectId: null } }))
}
