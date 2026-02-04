import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@multica/ui/components/ui/dialog'
import { Button } from '@multica/ui/components/ui/button'
import { Input } from '@multica/ui/components/ui/input'
import { Textarea } from '@multica/ui/components/ui/textarea'
import { Label } from '@multica/ui/components/ui/label'
import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon, Tick02Icon } from '@hugeicons/core-free-icons'

// Style options with labels
const STYLE_OPTIONS = [
  { value: 'concise', label: 'Concise', description: 'Brief and to the point' },
  { value: 'warm', label: 'Warm', description: 'Friendly and approachable' },
  { value: 'playful', label: 'Playful', description: 'Fun and lighthearted' },
  { value: 'professional', label: 'Professional', description: 'Formal and business-like' },
] as const

interface AgentSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AgentSettingsDialog({ open, onOpenChange }: AgentSettingsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [style, setStyle] = useState<string>('concise')
  const [userContent, setUserContent] = useState('')

  // Load profile data when dialog opens
  useEffect(() => {
    if (open) {
      loadProfile()
    }
  }, [open])

  const loadProfile = async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI.profile.get()
      setName(data.name ?? '')
      setStyle(data.style ?? 'concise')
      setUserContent(data.userContent ?? '')
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Update name if changed
      await window.electronAPI.profile.updateName(name)
      // Update style
      await window.electronAPI.profile.updateStyle(style)
      // Update user content
      await window.electronAPI.profile.updateUser(userContent)
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to save profile:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
          <DialogDescription>
            Customize your agent's name, style and personal settings.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <HugeiconsIcon icon={Loading03Icon} className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Assistant"
              />
            </div>

            {/* Style */}
            <div className="space-y-2">
              <Label>Communication Style</Label>
              <div className="grid grid-cols-2 gap-2">
                {STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStyle(option.value)}
                    className={`relative flex flex-col items-start rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                      style === option.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="font-medium text-sm">{option.label}</span>
                      {style === option.value && (
                        <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* User Content */}
            <div className="space-y-2">
              <Label htmlFor="user-content">About You</Label>
              <p className="text-xs text-muted-foreground">
                Help the agent understand you better. Share your preferences, role, or any context.
              </p>
              <Textarea
                id="user-content"
                value={userContent}
                onChange={(e) => setUserContent(e.target.value)}
                placeholder="- I'm a frontend developer&#10;- I prefer TypeScript&#10;- Please respond in Chinese"
                className="min-h-[120px] font-mono text-sm"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving && <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AgentSettingsDialog
