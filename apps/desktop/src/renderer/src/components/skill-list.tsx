import { useState } from 'react'
import { Button } from '@multica/ui/components/ui/button'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@multica/ui/components/ui/collapsible'
import { RotateCw, Loader2, ChevronRight } from 'lucide-react'
import { cn } from '@multica/ui/lib/utils'
import type { SkillInfo, SkillSource } from '../stores/skills'

// Source section titles
const SOURCE_TITLES: Record<SkillSource, string> = {
  bundled: 'Built-in Skills',
  global: 'Global Skills',
  profile: 'Profile Skills',
}

interface SkillListProps {
  skills: SkillInfo[]
  loading: boolean
  error: string | null
  onToggleSkill: (skillId: string) => Promise<void>
  onRefresh: () => Promise<void>
}

export function SkillList({
  skills,
  loading,
  error,
  onRefresh,
}: SkillListProps) {
  // Track which skills are expanded
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())

  const toggleSkill = (skillId: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(skillId)) {
        next.delete(skillId)
      } else {
        next.add(skillId)
      }
      return next
    })
  }

  // Group skills by source
  const skillsBySource: Record<SkillSource, SkillInfo[]> = {
    bundled: skills.filter((s) => s.source === 'bundled'),
    global: skills.filter((s) => s.source === 'global'),
    profile: skills.filter((s) => s.source === 'profile'),
  }

  // Order of sources to display
  const sourceOrder: SkillSource[] = ['bundled', 'global', 'profile']

  if (loading && skills.length === 0) {
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
          {skills.length} skill{skills.length !== 1 && 's'} available
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

      {/* Skills grouped by source */}
      {sourceOrder.map((source) => {
        const sourceSkills = skillsBySource[source]
        if (sourceSkills.length === 0) return null

        return (
          <div key={source}>
            {/* Section header */}
            <h3 className="text-sm font-medium mb-3">{SOURCE_TITLES[source]}</h3>

            {/* Skills card */}
            <div className="rounded-lg border bg-card">
              {sourceSkills.map((skill, index) => {
                const isExpanded = expandedSkills.has(skill.id)
                const isLast = index === sourceSkills.length - 1

                return (
                  <Collapsible
                    key={skill.id}
                    open={isExpanded}
                    onOpenChange={() => toggleSkill(skill.id)}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left',
                        !isLast && !isExpanded && 'border-b'
                      )}
                    >
                      <span className="text-sm font-medium flex-1">{skill.name}</span>
                      <code className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        {skill.triggers[0] || `/${skill.id}`}
                      </code>
                      <span className="text-xs text-muted-foreground">
                        {skill.version}
                      </span>
                      <ChevronRight
                        className={cn(
                          'size-4 text-muted-foreground transition-transform flex-shrink-0',
                          isExpanded && 'rotate-90'
                        )}
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div
                        className={cn(
                          'text-sm text-muted-foreground p-4',
                          !isLast && 'border-b'
                        )}
                      >
                        {skill.description || 'No description'}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Empty state */}
      {skills.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No skills found.
        </div>
      )}
    </div>
  )
}

export default SkillList
