import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api, type MemoryStoreMemory } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function CreateMemoryStoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('Project memory')
  const [description, setDescription] = useState('')
  const createStore = useMutation({
    mutationFn: () =>
      api.createMemoryStore({
        metadata: {
          name,
          ...(description ? { description } : {}),
        },
        spec: {},
      }),
    onSuccess: () => {
      onOpenChange(false)
      setName('Project memory')
      setDescription('')
      toast.success('Memory store created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Memory Store</SheetTitle>
          <SheetDescription>Create a reusable set of files that sessions can mount.</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-col gap-4 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault()
            createStore.mutate()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Description</FieldLabel>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={!name.trim()}>
            Create memory store
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}

export function MemoryEntrySheet({
  storeId,
  memory,
  open,
  onOpenChange,
}: {
  storeId: string
  memory: MemoryStoreMemory | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  useEffect(() => {
    if (!open) return
    setPath(memory?.spec.path ?? '')
    setContent(memory?.spec.content ?? '')
  }, [memory, open])
  const saveMemory = useMutation({
    mutationFn: () =>
      memory
        ? api.updateMemoryStoreMemory(storeId, memory.metadata.uid, { path, content })
        : api.createMemoryStoreMemory(storeId, { path, content }),
    onSuccess: () => {
      onOpenChange(false)
      toast.success(memory ? 'Memory updated' : 'Memory created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.memories(storeId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.detail(storeId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    saveMemory.mutate()
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{memory ? 'Edit Memory' : 'Add Memory'}</SheetTitle>
          <SheetDescription>Memory path is mounted under Enbor's managed store directory.</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 px-4 pb-4" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Path</FieldLabel>
              <Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="guides/review.md" />
            </Field>
            <Field>
              <FieldLabel>Content</FieldLabel>
              <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={14} />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={!path.trim() || !content.trim()}>
            Save memory
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
