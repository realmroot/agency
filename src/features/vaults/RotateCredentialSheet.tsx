import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcwKey } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { parseJsonObject } from '@/console/format'
import type { VaultCredential } from '@/lib/enborrpc'
import { api } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

export function RotateCredentialSheet({
  vaultId,
  credential,
  onOpenChange,
}: {
  vaultId: string
  credential: VaultCredential | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [stringData, setStringData] = useState('')
  const updateCredentialSecret = useMutation({
    mutationFn: (credentialId: string) =>
      api.updateVaultCredentialSecret(vaultId, credentialId, {
        stringData: Object.fromEntries(
          Object.entries(parseJsonObject(stringData, 'String data')).map(([key, value]) => [key, String(value)]),
        ),
      }),
    onSuccess: () => {
      onOpenChange(false)
      setStringData('')
      toast.success('Credential secret updated')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    /* v8 ignore start -- credential is null only when sheet is closed; form can't be submitted then */
    if (!credential || stringData.trim() === '') return
    /* v8 ignore stop */
    updateCredentialSecret.mutate(credential.metadata.uid)
  }

  return (
    <Sheet open={credential !== null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Update credential secret</SheetTitle>
          <SheetDescription>
            {/* v8 ignore start -- sheet is only open when credential !== null; the null fallback never renders */}
            {credential
              ? `Replace the secret material for ${credential.metadata.name}. Enbor records the change for auditability.`
              : 'Replace credential secret material.'}
            {/* v8 ignore stop */}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="rotate-string-data">New string data</FieldLabel>
                <Textarea
                  id="rotate-string-data"
                  autoComplete="off"
                  value={stringData}
                  onChange={(event) => setStringData(event.target.value)}
                />
                <FieldDescription>JSON object accepted only in this request and stored encrypted.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={stringData.trim() === '' || updateCredentialSecret.isPending}>
              <RotateCcwKey data-icon="inline-start" />
              {updateCredentialSecret.isPending ? 'Updating credential secret' : 'Update credential secret'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
