import { RefreshCw, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ConfirmAction,
  DetailSection,
  EmptyState,
  Meta,
  MetaGrid,
  StatusBadge,
  TableSurface,
} from '@/console/components'
import { formatDate } from '@/console/format'
import type { AuditRecord, Vault, VaultCredential } from '@/lib/enborrpc'

export function VaultDetailView({
  vault,
  credentials,
  auditRecords,
  loading,
  onAddCredential,
  onRotate,
  onRevoke,
}: {
  vault: Vault | null
  credentials: VaultCredential[]
  auditRecords: AuditRecord[]
  loading: boolean
  onAddCredential: () => void
  onRotate: (credential: VaultCredential) => void
  onRevoke: (credential: VaultCredential) => void
}) {
  if (loading) {
    return (
      <output aria-label="Loading vault detail" className="grid gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </output>
    )
  }
  if (!vault) return <EmptyState title="Vault not found" body="The requested vault is not in this project." />
  return (
    <div className="grid gap-4">
      <DetailSection
        title="Vault profile"
        description={vault.metadata.description ?? 'No description'}
        actions={
          <>
            <StatusBadge value={vault.status.phase} />
            <StatusBadge value={vault.spec.scope} />
          </>
        }
      >
        <MetaGrid>
          <Meta label="Vault id" value={vault.metadata.uid} />
          <Meta label="Created" value={formatDate(vault.metadata.createdAt)} />
        </MetaGrid>
      </DetailSection>
      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="credentials" className="mt-4">
          <DetailSection
            title="Credential metadata"
            description="Raw secret values are not returned by the control plane."
            actions={
              <Button type="button" onClick={onAddCredential}>
                Add credential
              </Button>
            }
          >
            {credentials.length === 0 ? (
              <EmptyState
                title="No credentials"
                body="Store a credential to track safe versioned secret references for runtime use."
                action={
                  <Button type="button" onClick={onAddCredential}>
                    Add credential
                  </Button>
                }
              />
            ) : (
              <TableSurface tableId="vault-credentials">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Secret reference</TableHead>
                    <TableHead>Data keys</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((credential) => (
                    <TableRow key={credential.metadata.uid}>
                      <TableCell className="font-medium">{credential.metadata.name}</TableCell>
                      <TableCell>{credential.spec.type}</TableCell>
                      <TableCell>
                        <StatusBadge value={credential.status.phase} />
                      </TableCell>
                      <TableCell>
                        {credential.status.activeVersion ? `v${credential.status.activeVersion.spec.version}` : 'None'}
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        {credential.status.activeVersion?.spec.referenceName ?? 'Not returned'}
                      </TableCell>
                      <TableCell className="max-w-72 truncate">
                        {credential.status.activeVersion?.spec.dataKeys.join(', ') || 'None'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {credential.status.phase === 'active' ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label="Update credential secret"
                                onClick={() => onRotate(credential)}
                              >
                                <RefreshCw data-icon="inline-start" />
                              </Button>
                              <ConfirmAction
                                title="Revoke credential?"
                                description={`Revoke ${credential.metadata.name}. Future runtime resolution is blocked; version references stay auditable.`}
                                confirmLabel="Revoke credential"
                                destructive
                                onConfirm={() => onRevoke(credential)}
                              >
                                <Button type="button" variant="outline" size="icon" aria-label="Revoke credential">
                                  <ShieldOff data-icon="inline-start" />
                                </Button>
                              </ConfirmAction>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableSurface>
            )}
          </DetailSection>
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <DetailSection title="Audit history" description="Vault and credential lifecycle activity for this vault.">
            {auditRecords.length === 0 ? (
              <EmptyState title="No audit history" body="Vault and credential changes will appear here." />
            ) : (
              <TableSurface tableId="vault-audit">
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.action}</TableCell>
                      <TableCell className="max-w-64 truncate">{record.resourceId ?? record.resourceType}</TableCell>
                      <TableCell>
                        <StatusBadge value={record.outcome} />
                      </TableCell>
                      <TableCell>{formatDate(record.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableSurface>
            )}
          </DetailSection>
        </TabsContent>
      </Tabs>
    </div>
  )
}
