import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PageHeader } from '@/console/components'
import { parsePackages, parseVariables, stringifyPackages } from '@/console/format'
import { EnvironmentForm } from '@/console/forms'
import type { EnvironmentFormState } from '@/console/types'
import { api, type Environment, type EnvironmentNetworking } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { EnvironmentDetailView } from './EnvironmentDetailView'
import { useEnvironmentActions } from './use-environment-actions'

function formStateFromEnvironment(environment: Environment): EnvironmentFormState {
  return {
    name: environment.metadata.name,
    description: environment.metadata.description ?? '',
    type: environment.spec.type,
    networkingType: environment.spec.networking.type,
    allowMcpServers: environment.spec.networking.allowMcpServers,
    allowPackageManagers: environment.spec.networking.allowPackageManagers,
    allowedHosts:
      environment.spec.networking.type === 'limited' ? (environment.spec.networking.allowedHosts ?? []).join('\n') : '',
    packages: stringifyPackages(environment.spec.packages),
    variables: Object.entries(environment.spec.variables)
      .map(
        ([name, variable]) =>
          `${name}=${typeof variable === 'object' && variable && 'value' in variable ? String(variable.value ?? '') : String(variable)}`,
      )
      .join('\n'),
  }
}

function networkingFromForm(form: EnvironmentFormState): EnvironmentNetworking {
  if (form.networkingType === 'limited') {
    return {
      type: 'limited',
      allowMcpServers: form.allowMcpServers,
      allowPackageManagers: form.allowPackageManagers,
      allowedHosts: form.allowedHosts
        .split(/\r?\n/)
        .map((host) => host.trim())
        .filter(Boolean),
    }
  }
  return {
    type: form.networkingType,
    allowMcpServers: form.allowMcpServers,
    allowPackageManagers: form.allowPackageManagers,
  }
}

export function EnvironmentDetailPage() {
  const { environmentId } = useParams()
  const queryClient = useQueryClient()
  const actions = useEnvironmentActions()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EnvironmentFormState | null>(null)
  const [formErrors, setFormErrors] = useState<{ name?: string }>({})
  const environmentQuery = useQuery({
    queryKey: queryKeys.environments.detail(environmentId ?? ''),
    queryFn: () => api.readEnvironment(environmentId as string),
    enabled: Boolean(environmentId),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(),
    queryFn: () => api.listSessions(),
  })
  const runnersQuery = useQuery({
    queryKey: queryKeys.runners.list({ environmentId: environmentId ?? '' }),
    queryFn: () => api.listRunners({ environmentId: environmentId as string }),
    enabled: Boolean(environmentId),
  })
  const environment = environmentQuery.data ?? null
  const updateEnvironment = useMutation({
    mutationFn: (input: EnvironmentFormState) =>
      api.updateEnvironment(environmentId as string, {
        metadata: {
          name: input.name,
          ...(input.description ? { description: input.description } : { description: null }),
        },
        spec: {
          type: input.type,
          networking: networkingFromForm(input),
          packages: parsePackages(input.packages),
          variables: parseVariables(input.variables),
        },
      }),
    onSuccess: () => {
      toast.success('Environment updated')
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Environment"
        title={environment?.metadata.name ?? 'Environment detail'}
        description={
          environment?.metadata.description ?? 'Inspect environment type, packages, variables, and networking.'
        }
        actions={
          environment ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(formStateFromEnvironment(environment))
                setEditing(true)
              }}
            >
              <Pencil data-icon="inline-start" />
              Edit environment
            </Button>
          ) : null
        }
      />
      <EnvironmentDetailView
        environment={environment}
        sessions={sessionsQuery.data?.data ?? []}
        runners={runnersQuery.data?.data ?? []}
        onDelete={actions.deleteEnvironment}
      />
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit environment</SheetTitle>
            <SheetDescription>
              Saving creates a new immutable environment version; existing sessions keep their snapshots.
            </SheetDescription>
          </SheetHeader>
          {form ? (
            <div className="px-4 pb-6">
              <EnvironmentForm
                value={form}
                setValue={(value) => {
                  setForm(value)
                  if (value.name.trim()) setFormErrors({})
                }}
                errors={formErrors}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!form.name.trim()) {
                    setFormErrors({ name: 'Name is required' })
                    return
                  }
                  updateEnvironment.mutate(form)
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
