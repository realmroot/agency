import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptyAgent } from '@/console/defaults'
import { parseTools, providerPatch } from '@/console/format'
import { AgentForm } from '@/console/forms'
import type { AgentFormState } from '@/console/types'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function CreateAgentSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AgentFormState>(emptyAgent)
  const createAgent = useMutation({
    mutationFn: () =>
      api.createAgent({
        metadata: {
          name: form.name,
          ...(form.description ? { description: form.description } : {}),
        },
        spec: {
          systemPrompt: form.systemPrompt,
          ...providerPatch(form.provider),
          model: /* v8 ignore start */ form.model || /* v8 ignore stop */ null,
          skills: parseTools(form.skills),
          allowedTools: parseTools(form.allowedTools),
          subagents: [],
          mcpConnectors: parseTools(form.mcpConnectors),
        },
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyAgent)
      toast.success('Agent created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createAgent.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Agent</SheetTitle>
          <SheetDescription>
            Define a reusable agent profile. Runtime environments are selected when creating sessions.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <AgentForm
            value={form}
            setValue={setForm}
            submitLabel={createAgent.isPending ? 'Creating agent' : 'Save agent'}
            onSubmit={submit}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
