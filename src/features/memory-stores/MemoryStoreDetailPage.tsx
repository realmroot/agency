import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Edit, FileText, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type NodeRendererProps, Tree } from 'react-arborist'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmAction, EmptyState, PageHeader, StatusBadge } from '@/console/components'
import { formatDate } from '@/console/format'
import { api, type MemoryStoreMemory } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { MemoryEntrySheet } from './MemoryStoreForms'

type MemoryTreeNodeData = {
  id: string
  name: string
  path: string
  kind: 'folder' | 'file'
  children?: MemoryTreeNodeData[]
  memory?: MemoryStoreMemory
}

export function MemoryStoreDetailPage() {
  const { storeId } = useParams()
  const queryClient = useQueryClient()
  const [editingMemory, setEditingMemory] = useState<MemoryStoreMemory | null>(null)
  const [entrySheetOpen, setEntrySheetOpen] = useState(false)
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null)
  const storeQuery = useQuery({
    queryKey: queryKeys.memoryStores.detail(storeId ?? ''),
    queryFn: () => api.readMemoryStore(storeId as string),
    enabled: Boolean(storeId),
  })
  const memoriesQuery = useQuery({
    queryKey: queryKeys.memoryStores.memories(storeId ?? ''),
    queryFn: () => api.listMemoryStoreMemories(storeId as string),
    enabled: Boolean(storeId),
  })
  const deleteMemory = useMutation({
    mutationFn: (memoryId: string) => api.deleteMemoryStoreMemory(storeId as string, memoryId),
    onSuccess: () => {
      toast.success('Memory deleted')
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryStores.memories(storeId ?? '') })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const store = storeQuery.data ?? null
  const memories = memoriesQuery.data?.data ?? []
  const treeData = useMemo(() => buildMemoryTree(memories), [memories])
  const selectedMemory = memories.find((memory) => memory.metadata.uid === selectedMemoryId) ?? null
  useEffect(() => {
    if (memories.length === 0) {
      setSelectedMemoryId(null)
      return
    }
    if (!selectedMemoryId || memories.every((memory) => memory.metadata.uid !== selectedMemoryId)) {
      setSelectedMemoryId(memories[0]?.metadata.uid ?? null)
    }
  }, [memories, selectedMemoryId])
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Memory Store"
        title={store?.metadata.name ?? 'Memory store detail'}
        description={store?.metadata.description ?? 'Manage reusable memory files mounted into sessions.'}
        actions={
          <Button
            type="button"
            onClick={() => {
              setEditingMemory(null)
              setEntrySheetOpen(true)
            }}
          >
            <Plus data-icon="inline-start" />
            Add memory
          </Button>
        }
      />
      {storeQuery.isLoading || memoriesQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Skeleton className="h-[32rem] w-full" />
          <Skeleton className="h-[32rem] w-full" />
        </div>
      ) : memories.length === 0 ? (
        <EmptyState title="No memories" body="Add a memory file to make this store useful in sessions." />
      ) : (
        <div className="grid min-h-[32rem] overflow-hidden rounded-lg border bg-background lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-w-0 border-b bg-muted/20 p-3 lg:border-r lg:border-b-0">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">Files</p>
              <StatusBadge value={`${memories.length} files`} />
            </div>
            <div className="overflow-hidden rounded-md border bg-background">
              <Tree<MemoryTreeNodeData>
                data={treeData}
                width="100%"
                height={464}
                indent={18}
                rowHeight={34}
                overscanCount={4}
                openByDefault
                {...(selectedMemoryId ? { selection: selectedMemoryId } : {})}
                childrenAccessor={(node) => node.children ?? null}
                disableDrag
                disableDrop
                disableEdit
                disableMultiSelection
                onActivate={(node) => {
                  if (node.data.kind === 'file' && node.data.memory) {
                    setSelectedMemoryId(node.data.memory.metadata.uid)
                  }
                }}
                aria-label="Memory files"
              >
                {MemoryTreeNode}
              </Tree>
            </div>
          </div>
          <MemoryFilePanel
            memory={selectedMemory}
            onEdit={(memory) => {
              setEditingMemory(memory)
              setEntrySheetOpen(true)
            }}
            onDelete={(memory) => deleteMemory.mutate(memory.metadata.uid)}
          />
        </div>
      )}
      {storeId ? (
        <MemoryEntrySheet
          storeId={storeId}
          memory={editingMemory}
          open={entrySheetOpen}
          onOpenChange={(open) => {
            setEntrySheetOpen(open)
            if (!open) setEditingMemory(null)
          }}
        />
      ) : null}
    </div>
  )
}

function MemoryFilePanel({
  memory,
  onEdit,
  onDelete,
}: {
  memory: MemoryStoreMemory | null
  onEdit: (memory: MemoryStoreMemory) => void
  onDelete: (memory: MemoryStoreMemory) => void
}) {
  if (!memory) {
    return <EmptyState title="No file selected" body="Select a memory file to inspect its content." />
  }
  return (
    <section className="flex min-w-0 flex-col gap-4 p-4" aria-label="Selected memory file">
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="break-all font-mono text-sm font-medium">{memory.spec.path}</p>
          <p className="mt-1 text-xs text-muted-foreground">Updated {formatDate(memory.metadata.updatedAt)}</p>
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Edit memory" onClick={() => onEdit(memory)}>
            <Edit data-icon="inline-start" />
          </Button>
          <ConfirmAction
            title="Delete memory?"
            description={`Delete ${memory.spec.path} from this memory store.`}
            confirmLabel="Delete memory"
            destructive
            onConfirm={() => onDelete(memory)}
          >
            <Button type="button" variant="outline" size="icon" aria-label="Delete memory">
              <Trash2 data-icon="inline-start" />
            </Button>
          </ConfirmAction>
        </div>
      </div>
      <pre className="min-h-[22rem] max-h-[30rem] overflow-auto rounded-lg bg-muted/60 p-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {memory.spec.content}
      </pre>
    </section>
  )
}

function MemoryTreeNode({ node, style }: NodeRendererProps<MemoryTreeNodeData>) {
  const Icon = node.data.kind === 'folder' ? (node.isOpen ? FolderOpen : Folder) : FileText
  return (
    <button
      type="button"
      style={style}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 px-2 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:size-4 [&_svg]:shrink-0',
        node.isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground',
      )}
      aria-label={node.data.kind === 'folder' ? `${node.data.name} folder` : `${node.data.path} file`}
      onClick={(event) => {
        event.stopPropagation()
        if (node.data.kind === 'folder') {
          node.toggle()
          return
        }
        node.activate()
      }}
    >
      {node.data.kind === 'folder' ? (
        <ChevronRight className={cn('transition-transform', node.isOpen ? 'rotate-90' : '')} aria-hidden="true" />
      ) : (
        <span className="size-4" aria-hidden="true" />
      )}
      <Icon aria-hidden="true" />
      <span className="truncate">{node.data.name}</span>
    </button>
  )
}

function buildMemoryTree(memories: MemoryStoreMemory[]) {
  const roots: MemoryTreeNodeData[] = []
  const folders = new Map<string, MemoryTreeNodeData>()
  for (const memory of [...memories].sort((left, right) => left.spec.path.localeCompare(right.spec.path))) {
    const parts = memory.spec.path.split('/').filter(Boolean)
    const fileName = parts.at(-1) ?? memory.spec.path
    let siblings = roots
    let folderPath = ''
    for (const part of parts.slice(0, -1)) {
      folderPath = folderPath ? `${folderPath}/${part}` : part
      let folder = folders.get(folderPath)
      if (!folder) {
        folder = { id: `folder:${folderPath}`, name: part, path: folderPath, kind: 'folder', children: [] }
        folders.set(folderPath, folder)
        siblings.push(folder)
      }
      siblings = folder.children ?? []
    }
    siblings.push({
      id: memory.metadata.uid,
      name: fileName,
      path: memory.spec.path,
      kind: 'file',
      memory,
    })
  }
  sortTree(roots)
  return roots
}

function sortTree(nodes: MemoryTreeNodeData[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  for (const node of nodes) {
    if (node.children) sortTree(node.children)
  }
}
