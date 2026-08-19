import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api, type CredentialType } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import {
  type CredentialFormState,
  credentialSecretData,
  credentialTypes,
  defaultCredentialData,
  emptyCredential,
  hasValidCredentialSecretData,
} from './credential-form-model'

export function AddCredentialSheet({
  vaultId,
  open,
  onOpenChange,
}: {
  vaultId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CredentialFormState>(emptyCredential)
  const createCredential = useMutation({
    mutationFn: () =>
      api.createVaultCredential(vaultId, {
        name: form.name,
        type: form.type,
        metadata: {},
        secret: { stringData: credentialSecretData(form) },
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyCredential)
      toast.success('Credential stored')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const valid = form.name.trim() !== '' && hasValidCredentialSecretData(form)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    createCredential.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add credential</SheetTitle>
          <SheetDescription>
            The secret data is encrypted at rest and never returned by the control plane.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="credential-name">Name</FieldLabel>
                <Input
                  id="credential-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="credential-type">Type</FieldLabel>
                <Select
                  value={form.type}
                  onValueChange={(type) =>
                    setForm({
                      ...form,
                      type: type as CredentialType,
                      data: defaultCredentialData(type as CredentialType),
                    })
                  }
                >
                  <SelectTrigger id="credential-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {credentialTypes.map(({ type, label }) => (
                      <SelectItem key={type} value={type}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Credential type defines which secret fields are required.</FieldDescription>
              </Field>
              <CredentialSecretFields form={form} setForm={setForm} />
            </FieldGroup>
            <Button type="submit" disabled={!valid || createCredential.isPending}>
              <KeyRound data-icon="inline-start" />
              {createCredential.isPending ? 'Saving credential' : 'Save credential'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CredentialSecretFields({
  form,
  setForm,
}: {
  form: CredentialFormState
  setForm: (form: CredentialFormState) => void
}) {
  const setData = (key: string, value: string) => {
    setForm({ ...form, data: { ...form.data, [key]: value } })
  }

  switch (form.type) {
    case 'opaque':
      return <OpaqueSecretFields form={form} setForm={setForm} />
    case 'ama.dev/basic-auth':
      return (
        <>
          <SecretInput label="Username" value={form.data.username!} onChange={(value) => setData('username', value)} />
          <SecretInput
            label="Password"
            type="password"
            value={form.data.password!}
            onChange={(value) => setData('password', value)}
          />
        </>
      )
    case 'ama.dev/ssh-auth':
      return (
        <SecretTextarea
          label="SSH private key"
          value={form.data['ssh-privatekey']!}
          onChange={(value) => setData('ssh-privatekey', value)}
        />
      )
    case 'ama.dev/tls':
      return (
        <>
          <SecretTextarea
            label="TLS certificate"
            value={form.data['tls.crt']!}
            onChange={(value) => setData('tls.crt', value)}
          />
          <SecretTextarea
            label="TLS private key"
            value={form.data['tls.key']!}
            onChange={(value) => setData('tls.key', value)}
          />
        </>
      )
    case 'ama.dev/private-key-jwk':
      return <SecretTextarea label="JWK" value={form.data.jwk!} onChange={(value) => setData('jwk', value)} />
    case 'ama.dev/oauth-token':
      return (
        <>
          <SecretInput
            label="Access token"
            type="password"
            value={form.data['access-token']!}
            onChange={(value) => setData('access-token', value)}
          />
          <SecretInput
            label="Refresh token"
            type="password"
            value={form.data['refresh-token']!}
            onChange={(value) => setData('refresh-token', value)}
          />
          <SecretInput
            label="Token type"
            value={form.data['token-type']!}
            onChange={(value) => setData('token-type', value)}
          />
          <SecretInput
            label="Expires at"
            value={form.data['expires-at']!}
            onChange={(value) => setData('expires-at', value)}
          />
          <SecretInput label="Scopes" value={form.data.scopes!} onChange={(value) => setData('scopes', value)} />
        </>
      )
    case 'ama.dev/realmroot-agent-state':
      return (
        <SecretTextarea
          label="Realmroot Agent state JSON"
          description="Paste the complete YW1h.json enrolled with AGENT=ama. AMA stores it as state.json."
          value={form.data['state.json']!}
          onChange={(value) => setData('state.json', value)}
        />
      )
  }
}

function OpaqueSecretFields({
  form,
  setForm,
}: {
  form: CredentialFormState
  setForm: (form: CredentialFormState) => void
}) {
  const entries = Object.entries(form.data)
  const updateEntry = (index: number, nextKey: string, nextValue: string) => {
    setForm({
      ...form,
      data: Object.fromEntries(
        entries.map(([key, value], itemIndex) => (itemIndex === index ? [nextKey, nextValue] : [key, value])),
      ),
    })
  }
  const removeEntry = (index: number) => {
    const nextEntries = entries.filter((_, itemIndex) => itemIndex !== index)
    setForm({ ...form, data: Object.fromEntries(nextEntries.length > 0 ? nextEntries : [['value', '']]) })
  }
  return (
    <FieldSet>
      <FieldLegend>Secret data</FieldLegend>
      <FieldDescription>Opaque credentials can store one or more named secret values.</FieldDescription>
      <div className="flex flex-col gap-3">
        {entries.map(([key, value], index) => (
          <div key={key} className="grid grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_2rem] gap-2">
            <Input
              aria-label={`Data key ${index + 1}`}
              value={key}
              onChange={(event) => updateEntry(index, event.target.value, value)}
            />
            <Input
              aria-label={`Data value ${index + 1}`}
              autoComplete="off"
              type="password"
              value={value}
              onChange={(event) => updateEntry(index, key, event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove data key ${index + 1}`}
              onClick={() => removeEntry(index)}
            >
              <Trash2 data-icon="inline-start" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => setForm({ ...form, data: { ...form.data, [`key${entries.length + 1}`]: '' } })}
        >
          <Plus data-icon="inline-start" />
          Add secret value
        </Button>
      </div>
    </FieldSet>
  )
}

function SecretInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
}) {
  const id = `credential-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} autoComplete="off" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function SecretTextarea({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
}) {
  const id = `credential-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}
