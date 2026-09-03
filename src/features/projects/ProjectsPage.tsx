import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, PageHeader, ResourceIdentityCell, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import { TextField } from '@/console/forms'
import { api, type Project } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { useConsoleContext } from '../console/console-context'

const DEFAULT_PROJECT_NAME = 'Default'

export function ProjectsPage() {
  const context = useConsoleContext()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list,
    queryFn: () => api.listProjects(),
  })
  const projects = projectsQuery.data?.data ?? []
  const renameProject = useMutation({
    mutationFn: ({ projectId, nextName }: { projectId: string; nextName: string }) =>
      api.updateProject(projectId, { name: nextName }),
    onSuccess: () => {
      setEditing(null)
      setName('')
      toast.success('Project renamed')
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const removeProject = useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: (_result, projectId) => {
      if (projectId === context.auth.project.id) {
        const defaultProject = projects.find((project) => project.name === DEFAULT_PROJECT_NAME)
        if (defaultProject) context.selectProject(defaultProject.id)
      }
      toast.success('Project deleted')
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const beginRename = (project: Project) => {
    setEditing(project)
    setName(project.name)
  }
  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    renameProject.mutate({ projectId: editing.id, nextName: name.trim() })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Projects"
        title="Project management"
        description="Rename or remove projects in this organization. The Default project is managed by the system."
      />
      {projectsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : projectsQuery.isError ? (
        <EmptyState title="Projects unavailable" body={errorMessage(projectsQuery.error)} />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects" body="Create a project from the project switcher." />
      ) : (
        <TableSurface tableId="projects" className="max-h-none">
          <colgroup>
            <col />
            <col className="w-[7rem]" />
            <col className="hidden md:table-column md:w-[11rem]" />
            <col className="hidden lg:table-column lg:w-[11rem]" />
            <col className="w-[7.5rem]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Created</TableHead>
              <TableHead className="hidden lg:table-cell">Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const isDefault = project.name === DEFAULT_PROJECT_NAME
              return (
                <TableRow key={project.id}>
                  <TableCell className="min-w-0">
                    <ResourceIdentityCell name={project.name} id={project.id} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={isDefault ? 'secondary' : 'outline'}>{isDefault ? 'System' : 'Custom'}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(project.createdAt)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(project.updatedAt)}</TableCell>
                  <TableCell>
                    {isDefault ? (
                      <span className="block text-right text-xs text-muted-foreground">Managed</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Rename ${project.name}`}
                          onClick={() => beginRename(project)}
                        >
                          <Pencil />
                        </Button>
                        <ConfirmAction
                          title="Delete project?"
                          description={`Delete ${project.name}. Projects that still own resources cannot be deleted.`}
                          confirmLabel="Delete project"
                          destructive
                          onConfirm={() => removeProject.mutate(project.id)}
                        >
                          <Button type="button" variant="outline" size="icon" aria-label={`Delete ${project.name}`}>
                            <Trash2 />
                          </Button>
                        </ConfirmAction>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </TableSurface>
      )}
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Rename project</SheetTitle>
            <SheetDescription>Project names must be unique within this organization.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <form className="flex flex-col gap-4" onSubmit={submitRename}>
              <FieldGroup>
                <TextField label="Name" value={name} onChange={setName} />
              </FieldGroup>
              <Button
                type="submit"
                disabled={renameProject.isPending || name.trim().length === 0 || name.trim() === editing?.name}
              >
                <Pencil data-icon="inline-start" />
                {renameProject.isPending ? 'Renaming project' : 'Rename project'}
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
