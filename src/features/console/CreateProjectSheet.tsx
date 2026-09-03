import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TextField } from '@/console/forms'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { useConsoleContext } from './console-context'

export function CreateProjectSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const context = useConsoleContext()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const createProject = useMutation({
    mutationFn: () => api.createProject({ name: name.trim() }),
    onSuccess: async (project) => {
      onOpenChange(false)
      setName('')
      toast.success('Project created')
      // Refresh the project list before switching so the new project resolves
      // immediately, then invalidate everything else for the new scope.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.list })
      context.selectProject(project.id)
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createProject.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create project</SheetTitle>
          <SheetDescription>
            A project isolates its own agents, environments, sessions, and credentials. Switch projects anytime from the
            sidebar.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <TextField label="Name" value={name} onChange={setName} />
            </FieldGroup>
            <Button type="submit" disabled={createProject.isPending || name.trim().length === 0}>
              <FolderPlus data-icon="inline-start" />
              {createProject.isPending ? 'Creating project' : 'Create project'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
