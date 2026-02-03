# @multica/desktop

Electron desktop app. Vite + React + `createHashRouter`.

## Development

```bash
multica dev desktop
```

## Build

```bash
pnpm --filter @multica/desktop build
```

## Conventions

- **Routing**: `react-router-dom` v7 with `createHashRouter` (Electron loads via `file://`, BrowserRouter won't work). Pages go in `src/pages/`.
- **UI**: All components from `@multica/ui`. No local UI components.
- **State**: Store hooks from `@multica/store`.
- **Styles**: Tailwind CSS v4 via `@multica/ui/globals.css`, imported in `src/main.tsx`.
