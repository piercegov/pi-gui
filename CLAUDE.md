# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
bun install                # Install dependencies
bun run dev:hmr            # Development with HMR (recommended) - runs Vite dev server + Electrobun
bun run dev                # Development without HMR (loads bundled assets, must rebuild to see changes)
bun run dev:mock           # Seeded mock workflow for cloud-agent demo recordings
bun run dev:hmr:mock       # Same mock workflow with HMR
bun run build              # Production build (vite build + electrobun build)
bunx tsc --noEmit          # Typecheck (also: bun run typecheck)
npx vite build             # Frontend-only build (useful for quick validation)
```

No test runner is configured. No linter/formatter is configured.

## Mock workflow for cloud-agent demos

When you need a deterministic end-to-end demo without real model credentials, launch the app with:

```bash
PI_GUI_MOCK_WORKFLOW=cursor-cloud-demo bun run dev
```

or use `bun run dev:mock` / `bun run dev:hmr:mock`.

Important:

- this workflow is intentionally gated behind the `PI_GUI_MOCK_WORKFLOW` env var
- it is for agent/debug/demo use only
- normal `dev`, `dev:hmr`, and production builds should not expose it

## Architecture Overview

Pi GUI is a **desktop coding assistant** built on **Electrobun** (not Electron). It wraps the `@mariozechner/pi-coding-agent` library in a native macOS app with session management, code review, and diff viewing.

### Process Model

**Bun process** (backend) communicates with **React webview** (frontend) via Electrobun's typed RPC system.

```
┌─────────────────────────┐       RPC (typed, Zod-validated)       ┌──────────────────────┐
│  Bun Main Process       │ ◄──────────────────────────────────► │  React Webview (UI)  │
│                         │   requests: sendPrompt, buildDiff...   │                      │
│  - RuntimeManager       │   messages: sessionEvent, terminalData │  - Zustand stores    │
│  - SessionService       │                                        │  - React components  │
│  - ReviewService        │                                        │                      │
│  - SQLite DB            │                                        │                      │
└─────────────────────────┘                                        └──────────────────────┘
```

### Source Layout

```
apps/desktop/src/
├── bun/                    # Backend (Bun main process)
│   ├── index.ts            # Electrobun RPC handler registration & message broker
│   ├── pi/                 # Pi coding agent integration
│   │   └── runtime-manager.ts  # Manages AgentSession instances, maps events to UI
│   └── services/           # Business logic
│       ├── session-service.ts  # Session CRUD, turn tracking, runtime lifecycle
│       ├── review-service.ts   # Review rounds, comment threads, alignment
│       ├── db.ts               # SQLite schema & migrations
│       ├── git-service.ts      # Git operations via Bun.spawn
│       └── terminal-service.ts # PTY via Bun.Terminal
├── shared/                 # Shared between bun and ui
│   ├── models.ts           # All TypeScript interfaces (SessionSummary, ConversationEntryView, etc.)
│   ├── rpc-schema.ts       # RPC request/message type definitions
│   └── zod-schemas.ts      # Zod validation for RPC payloads
└── ui/                     # Frontend (React)
    ├── app.tsx             # Root component, ResizeHandle, event listener setup
    ├── stores/             # Zustand stores (conversation, sessions, review, layout, etc.)
    ├── components/         # UI organized by feature (chat/, diff/, sidebar/, etc.)
    └── lib/                # Utilities (rpc-client.ts, markdown.tsx, shiki.ts)

packages/
├── pi-review-extension/    # Pi agent extension for review workflows
└── shared-prompts/         # Prompt templates
```

### Path Aliases (tsconfig)

- `@bun/*` → `apps/desktop/src/bun/*`
- `@shared/*` → `apps/desktop/src/shared/*`
- `@ui/*` → `apps/desktop/src/ui/*`
- `@pi-gui/review-extension` → `packages/pi-review-extension/src/index.ts`

## Key Patterns

### RPC Communication

Backend registers handlers in `bun/index.ts` via `defineElectrobunRPC`. Frontend calls them via `rpc.request.*` from `ui/lib/rpc-client.ts`. Backend pushes real-time updates via `sendToView()` messages (sessionEvent, diffInvalidated, terminalData, etc.). Frontend subscribes via `rpc.addMessageListener()` in the main `useEffect` in `app.tsx`.

### Event Streaming (Conversation)

The Pi agent emits events (`message_start`, `message_delta`, `message_end`, `tool_execution_start`, etc.) which `RuntimeManager.handleEvent()` maps to `SessionStreamEvent` types and emits to the UI. The conversation store applies these incrementally. User messages are emitted synthetically by `RuntimeManager` at prompt time since the SDK only streams model-generated content.

### Session Lifecycle

Sessions can run in **worktree** mode (isolated git worktree) or **local** mode (edits in-place). Each session has a Pi `AgentSession` managed by `RuntimeManager`. Turns are numbered with before/after git checkpoints. Status transitions: idle → running → (review cycle) → aligned → applied.

### Review System

The `pi-review-extension` package hooks into the Pi agent to:
- Block file-mutating tools during review freeze (`shouldBlockMutatingTool`)
- Track review rounds with comment threads anchored to diff lines
- Handle agent replies via a custom `review_reply` tool
- Manage alignment (user accepts changes) and application

### State Management

Seven Zustand stores in `ui/stores/`. Each has a `hydrate()` method populated from the `SessionHydration` payload returned by `openSession`. Live updates come through `applyEvent()` from the event listener in `app.tsx`. Use functional `set()` in Zustand callbacks to avoid stale closures.

### Diff System

Diffs are scoped (`DiffScope`: session_changes, staged, unstaged, branch_vs_base, etc.) and computed on-demand by `ReviewService.buildDiff()`. The UI uses `react-diff-view` with `refractor` for syntax highlighting. Diff CSS variables are defined in `ui/index.css` under `.diff-shell`. The base stylesheet `react-diff-view/style/index.css` must be imported for line coloring to work.

## Styling

Dark theme using CSS custom properties defined in `ui/index.css` (--surface-*, --accent-*, --state-*). Tailwind maps these via `tailwind.config.js`. Design targets native macOS aesthetic: flat edges, dividers (not rounded floating cards), system fonts.

## Gotchas

- **Electrobun, not Electron**: Different APIs, uses Bun runtime natively. Process name in dev is `bun`, not the app name.
- **refractor v5 compat**: Returns `{type:"root",children:[...]}` not an array. Use the `refractorCompat` wrapper in `diff-pane.tsx` that returns `.children`.
- **Stale closures in drag handlers**: Use a ref pattern (`onDragRef.current = props.onDrag`) + functional Zustand `set()` for resize handles.
- **No automated tests**: Validation is manual via `docs/ui-testing.md` (macOS accessibility automation scripts).
- **SQLite via bun:sqlite**: Direct import, no ORM. Schema managed in `db.ts`.
