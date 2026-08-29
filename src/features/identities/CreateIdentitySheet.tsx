import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api, type IdentityRuntime } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

const INITIAL = { name: '', description: '', username: '', runtime: 'codex' as IdentityRuntime }

export function CreateIdentitySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(INITIAL)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const updateForm = (next: typeof INITIAL) => {
    setForm(next)
    setIdempotencyKey(crypto.randomUUID())
  }
  const create = useMutation({
    mutationFn: () =>
      api.createIdentity(
        {
          metadata: { name: form.name, ...(form.description ? { description: form.description } : {}) },
          spec: { username: form.username, runtime: form.runtime },
        },
        idempotencyKey,
      ),
    onSuccess: () => {
      setForm(INITIAL)
      setIdempotencyKey(crypto.randomUUID())
      onOpenChange(false)
      toast.success('Identity created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.identities.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Identity</SheetTitle>
          <SheetDescription>
            Provision a Realmroot Agent and store its private installation state in an AMA-managed Vault.
          </SheetDescription>
        </SheetHeader>
        <form className="px-4 pb-4" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="identity-name">Name</FieldLabel>
              <Input
                id="identity-name"
                required
                value={form.name}
                onChange={(event) => updateForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="identity-description">Description</FieldLabel>
              <Textarea
                id="identity-description"
                value={form.description}
                onChange={(event) => updateForm({ ...form, description: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="identity-username">Realmroot username</FieldLabel>
              <Input
                id="identity-username"
                required
                pattern="[a-z0-9][a-z0-9-]*"
                value={form.username}
                onChange={(event) => updateForm({ ...form, username: event.target.value })}
              />
              <FieldDescription>Lowercase letters, numbers, and hyphens.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Runtime</FieldLabel>
              <Select
                value={form.runtime}
                onValueChange={(runtime) => updateForm({ ...form, runtime: runtime as IdentityRuntime })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="ama">AMA</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="claude-code">Claude Code</SelectItem>
                    <SelectItem value="copilot">Copilot</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Runtime is immutable. Agents and sessions using this Identity inherit it.
              </FieldDescription>
            </Field>
            <Button type="submit" disabled={create.isPending || !form.name.trim() || !form.username.trim()}>
              {create.isPending ? 'Provisioning identity…' : 'Create identity'}
            </Button>
          </FieldGroup>
        </form>
      </SheetContent>
    </Sheet>
  )
}
