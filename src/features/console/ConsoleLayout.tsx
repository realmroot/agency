import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { FullscreenMessage } from '@/console/components'
import { ApiError, api } from '@/lib/amarpc'
import { getCurrentUser, signIn } from '@/lib/oidc'
import { getSelectedProjectId, setSelectedProjectId } from '@/lib/project-selection'
import { queryKeys } from '@/lib/query-keys'
import { ConsoleShell } from './ConsoleShell'
import { ConsoleContextProvider } from './console-context'

export function ConsoleLayout() {
  const [selectedProjectId, setSelectedProjectState] = useState(() => getSelectedProjectId())
  const userQuery = useQuery({
    queryKey: queryKeys.auth.user,
    queryFn: getCurrentUser,
    retry: false,
  })
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list,
    queryFn: api.listProjects,
    enabled: Boolean(userQuery.data),
    retry: false,
  })

  useEffect(() => {
    function handleProjectChange() {
      setSelectedProjectState(getSelectedProjectId())
    }
    window.addEventListener('ama:selected-project-changed', handleProjectChange)
    return () => window.removeEventListener('ama:selected-project-changed', handleProjectChange)
  }, [])

  const projects = projectsQuery.data?.data ?? []
  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null
  }, [projects, selectedProjectId])

  useEffect(() => {
    if (selectedProject && selectedProject.id !== selectedProjectId) {
      setSelectedProjectId(selectedProject.id)
    }
  }, [selectedProject, selectedProjectId])

  if (userQuery.isLoading || (userQuery.data && projectsQuery.isLoading)) {
    return <FullscreenMessage title="Loading console" body="Checking session and project list." />
  }

  if (
    !userQuery.data ||
    userQuery.error ||
    (projectsQuery.error instanceof ApiError && projectsQuery.error.status === 401)
  ) {
    const returnTo = `${window.location.pathname}${window.location.search}`
    return (
      <FullscreenMessage
        title="Any Managed Agents"
        body="Sign in through OIDC provider to open the control plane."
        action={
          <Button size="lg" onClick={() => void signIn(returnTo)}>
            Continue with OIDC provider
          </Button>
        }
      />
    )
  }

  if (projectsQuery.error) {
    const message =
      projectsQuery.error instanceof ApiError ? projectsQuery.error.message : 'Unable to load the project list.'
    return <FullscreenMessage title="Console unavailable" body={message} />
  }

  if (!selectedProject) {
    return <FullscreenMessage title="Console unavailable" body="Unable to create or load a project." />
  }

  const profile = userQuery.data.profile
  const email = typeof profile.email === 'string' ? profile.email : ''
  const name = typeof profile.name === 'string' ? profile.name : null
  const auth = {
    user: {
      id: profile.sub,
      email,
      name,
      avatarUrl: typeof profile.picture === 'string' ? profile.picture : null,
    },
    organization: userQuery.data.organization,
    project: {
      id: selectedProject.id,
      name: selectedProject.name,
    },
    roles: [],
    permissions: [],
  }

  return (
    <ConsoleContextProvider
      value={{
        auth,
        projects,
        selectProject: (projectId) => setSelectedProjectId(projectId),
      }}
    >
      <ConsoleShell>
        <Outlet />
      </ConsoleShell>
    </ConsoleContextProvider>
  )
}
