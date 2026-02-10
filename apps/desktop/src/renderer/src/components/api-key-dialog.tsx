import { useState } from 'react'
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
import { Label } from '@multica/ui/components/ui/label'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@multica/ui/components/ui/combobox'
import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon, Key01Icon } from '@hugeicons/core-free-icons'

interface ApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerId: string
  providerName: string
  showModelInput?: boolean
  models?: string[]
  onSuccess?: (modelId?: string) => void
}

export function ApiKeyDialog({
  open,
  onOpenChange,
  providerId,
  providerName,
  showModelInput,
  models,
  onSuccess,
}: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('API key is required')
      return
    }

    if (showModelInput && !modelId) {
      setError('Please select a model')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const result = await window.electronAPI.provider.saveApiKey(providerId, apiKey.trim())
      if (result.ok) {
        setApiKey('')
        setModelId(null)
        onOpenChange(false)
        onSuccess?.(showModelInput && modelId ? modelId : undefined)
      } else {
        setError(result.error ?? 'Failed to save API key')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setApiKey('')
      setModelId(null)
      setError(null)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Key01Icon} className="size-5" />
            Configure {providerName}
          </DialogTitle>
          <DialogDescription>
            Enter your API key to enable {providerName}. The key will be saved securely in your credentials file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) {
                  handleSave()
                }
              }}
            />
          </div>

          {showModelInput && models && models.length > 0 && (
            <div className="space-y-2">
              <Label>Model</Label>
              <Combobox
                value={modelId}
                onValueChange={(value) => setModelId(value)}
              >
                <ComboboxInput placeholder="Search models..." showClear />
                <ComboboxContent>
                  <ComboboxList>
                    {models.map((model) => (
                      <ComboboxItem key={model} value={model} textValue={model}>
                        {model}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                  <ComboboxEmpty>No models found</ComboboxEmpty>
                </ComboboxContent>
              </Combobox>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <p className="text-xs text-muted-foreground">
            Your API key is stored locally in <code className="bg-muted px-1 rounded">~/.super-multica/credentials.json5</code>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !apiKey.trim() || (showModelInput && !modelId)}>
            {saving && <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ApiKeyDialog
