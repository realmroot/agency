import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptyVault } from '@/console/defaults'
import { VaultForm } from '@/console/forms'
import type { VaultFormState } from '@/console/types'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function CreateVaultSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<VaultFormState>(emptyVault)
  const createVault = useMutation({
    mutationFn: () =>
      api.createVault({
        metadata: {
          name: form.name,
          ...(form.description ? { description: form.description } : {}),
        },
        spec: { scope: form.scope },
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyVault)
      toast.success('Vault created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createVault.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Vault</SheetTitle>
          <SheetDescription>Create safe credential-reference metadata for runtime integrations.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <VaultForm value={form} setValue={setForm} onSubmit={submit} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
