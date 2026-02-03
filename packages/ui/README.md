# @multica/ui

Shared UI component library. Shadcn + Tailwind CSS v4.

## Usage

```tsx
// UI components — subpath imports, no barrel
import { Button } from '@multica/ui/components/ui/button'
import { Card, CardContent } from '@multica/ui/components/ui/card'

// Feature components
import { ThemeProvider } from '@multica/ui/components/theme-provider'
import { Chat } from '@multica/ui/components/chat'
import { Markdown } from '@multica/ui/components/markdown'

// Hooks
import { useIsMobile } from '@multica/ui/hooks/use-mobile'
import { useAutoScroll } from '@multica/ui/hooks/use-auto-scroll'

// Utilities
import { cn } from '@multica/ui/lib/utils'

// Styles (app entry point)
import '@multica/ui/globals.css'
```

## Adding Components

```bash
pnpm --filter @multica/ui dlx shadcn@latest add <component>
```
