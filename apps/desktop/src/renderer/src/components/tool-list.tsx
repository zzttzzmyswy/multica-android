import { useState, useMemo } from 'react'
import { Switch } from '@multica/ui/components/ui/switch'
import { Button } from '@multica/ui/components/ui/button'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@multica/ui/components/ui/collapsible'
import {
  RotateCw,
  FolderOpen,
  Code,
  Globe,
  Brain,
  ChevronRight,
  Loader2,
  Clock,
  Users,
} from 'lucide-react'
import { cn } from '@multica/ui/lib/utils'
import type { ToolInfo } from '../stores/tools'

// Group display names
const GROUP_NAMES: Record<string, string> = {
  fs: 'File System',
  runtime: 'Runtime',
  web: 'Web',
  memory: 'Memory',
  subagent: 'Subagent',
  cron: 'Cron',
  other: 'Other',
}

// Group descriptions
const GROUP_DESCRIPTIONS: Record<string, string> = {
  fs: 'Read, write, and manage files',
  runtime: 'Execute code and commands',
  web: 'Fetch and interact with web content',
  memory: 'Store and recall information',
  subagent: 'Delegate tasks to sub-agents',
  cron: 'Schedule recurring tasks',
  other: 'Miscellaneous tools',
}

// Group icons
const GROUP_ICONS: Record<string, typeof FolderOpen> = {
  fs: FolderOpen,
  runtime: Code,
  web: Globe,
  memory: Brain,
  subagent: Users,
  cron: Clock,
  other: Code,
}

interface ToolListProps {
  tools: ToolInfo[]
  loading: boolean
  error: string | null
  onToggleTool: (toolName: string) => Promise<void>
  onRefresh: () => Promise<void>
}

export function ToolList({
  tools,
  loading,
  error,
  onToggleTool,
  onRefresh,
}: ToolListProps) {
  // Compute groups from tools
  const groups = useMemo(() => {
    const groupIds = [...new Set(tools.map((t) => t.group))]
    return groupIds.map((id) => ({
      id,
      name: GROUP_NAMES[id] || id,
      description: GROUP_DESCRIPTIONS[id] || '',
      tools: tools.filter((t) => t.group === id),
      enabledCount: tools.filter((t) => t.group === id && t.enabled).length,
      totalCount: tools.filter((t) => t.group === id).length,
    }))
  }, [tools])

  // Track which groups are expanded
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.id))
  )

  // Track toggling state for individual tools
  const [togglingTools, setTogglingTools] = useState<Set<string>>(new Set())

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const handleToggleTool = async (toolName: string) => {
    setTogglingTools((prev) => new Set(prev).add(toolName))
    try {
      await onToggleTool(toolName)
    } finally {
      setTogglingTools((prev) => {
        const next = new Set(prev)
        next.delete(toolName)
        return next
      })
    }
  }

  if (loading && tools.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tools.filter((t) => t.enabled).length} of {tools.length} tools enabled
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="gap-1.5 h-8"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCw className="size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Tool groups */}
      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.id)
        const GroupIcon = GROUP_ICONS[group.id] || Code

        return (
          <div key={group.id}>
            {/* Section header */}
            <div className="mb-3 flex items-start gap-2">
              <GroupIcon className="size-4 text-muted-foreground mt-0.5" />
              <div>
                <h3 className="text-sm font-medium">{group.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {group.enabledCount}/{group.totalCount} enabled
                </p>
              </div>
            </div>

            {/* Tools card */}
            <Collapsible open={isExpanded} onOpenChange={() => toggleGroup(group.id)}>
              <div className="rounded-lg border bg-card">
                <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left">
                  <span className="text-sm text-muted-foreground">
                    {group.description}
                  </span>
                  <ChevronRight
                    className={cn(
                      'size-4 text-muted-foreground transition-transform flex-shrink-0',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t">
                    {group.tools.map((tool, index) => {
                      const isToggling = togglingTools.has(tool.name)
                      const isLast = index === group.tools.length - 1

                      return (
                        <div
                          key={tool.name}
                          className={cn(
                            'flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors',
                            !isLast && 'border-b'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <code className="text-sm font-mono">{tool.name}</code>
                            {tool.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {tool.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            {isToggling && (
                              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={tool.enabled}
                              onCheckedChange={() => handleToggleTool(tool.name)}
                              disabled={isToggling}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
        )
      })}

      {/* Note */}
      <p className="text-xs text-muted-foreground">
        Changes apply immediately to the running Agent.
      </p>
    </div>
  )
}

export default ToolList
