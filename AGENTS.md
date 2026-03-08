# AGENTS.md

Guidance for coding agents working in **Pi GUI**.

This file is intentionally detailed so an agent can make safe, architecture-aware changes without guessing.

---

## 1) Project Mission

Pi GUI is a desktop app (Electrobun + Bun + React) for managing AI coding sessions with:

- project/session management
- Git-aware workspaces (including isolated worktrees)
- live conversation + tool activity streaming
- diff review with inline threads
- structured review rounds and approval/apply flows
- per-session embedded terminal

---

## 2) Source of Truth and Active Code Paths

### Active app code (use this)

- `apps/desktop/src/bun/*` — Bun main process, services, runtime integration
- `apps/desktop/src/ui/*` — React UI + Zustand stores
- `apps/desktop/src/shared/*` — shared models, RPC schema, Zod schemas
- `packages/pi-review-extension/*` — Pi extension for review workflows
- `packages/shared-prompts/*` — review/alignment prompt fragments

### Legacy template code (generally ignore)

- `src/*` and root `README.md` are Electrobun template leftovers and not the primary app implementation.

### Generated artifacts (do not hand-edit)

- `apps/desktop/dist/*`
- `dist/*`
- `build/*`

---

## 3) Stack and Constraints

- **Runtime**: Bun
- **Desktop shell**: Electrobun (**not Electron**)
- **UI**: React 18 + Zustand + Tailwind + Radix
- **Type safety**: TypeScript strict mode + Zod validation
- **Data**: SQLite via `bun:sqlite`
- **Diff UI**: `react-diff-view` + `refractor`
- **Terminal**: `Bun.Terminal` backend + `xterm` frontend

Non-negotiable: do not introduce Electron APIs/patterns.

---

## 4) Build / Dev Commands

From repo root:

```bash
bun install
bun run dev:hmr      # recommended: Vite HMR + electrobun dev --watch
bun run dev          # no HMR; bundled assets path
bun run build        # production build
bun run build:canary # canary environment build
bun run typecheck    # bunx tsc --noEmit
```

Useful extra checks:

```bash
npx vite build       # frontend-only build
```

No test runner and no lint/format pipeline are configured.

---

## 5) High-Level Architecture

Pi GUI has two processes:

1. **Bun main process** (`apps/desktop/src/bun/index.ts`)
   - Registers typed RPC handlers (`defineElectrobunRPC`)
   - Owns services (sessions, review, git, checkpoints, settings, terminal)
   - Pushes real-time messages to webview (session events, revision updates, terminal data, etc.)

2. **React webview** (`apps/desktop/src/ui/app.tsx`)
   - Calls backend via typed RPC client
   - Hydrates Zustand stores from `openSession`
   - Applies streamed updates incrementally

Shared contracts live in:

- `apps/desktop/src/shared/models.ts`
- `apps/desktop/src/shared/rpc-schema.ts`
- `apps/desktop/src/shared/zod-schemas.ts`

---

## 6) Core Services (Backend)

### `session-service.ts`

Responsible for:

- create/open/list/rename/archive sessions
- worktree provisioning/repair
- runtime hook wiring (turn start/end, status patches)
- checkpoint creation around turns
- session hydration payload assembly

### `review-service.ts`

Responsible for:

- revision/round lifecycle
- comment threads/messages
- publish discussion prompts
- resolve/reopen/approve/start-next/apply/apply+merge
- handling agent `review_reply` payloads

### `runtime-manager.ts`

Responsible for:

- opening/managing Pi `AgentSession`s
- mapping Pi stream events to app `SessionStreamEvent`s
- tracking tool activity
- dispatching review discussion prompts/custom messages
- integrating review extension event bus

### `git-service.ts`

Responsible for:

- worktree creation/merge/repair operations
- tree snapshots and diff computation
- status checks
- commit/apply operations

### `checkpoint-service.ts`

Responsible for:

- checkpoint persistence
- diff snapshot persistence (`.patch` files + metadata)

### `settings-service.ts`

- app settings defaults + persistence in `ui_preferences`

### `terminal-service.ts`

- Bun PTY lifecycle + stream relay

---

## 7) Data & Persistence

DB file path is platform-specific under app data (`app-paths.ts`).

Important tables:

- `projects`
- `sessions`
- `turns`
- `checkpoints`
- `diff_snapshots`
- `review_rounds`
- `comment_threads`
- `comment_messages`
- `ui_preferences`

If you change schema:

1. update `SCHEMA_SQL` in `db.ts`
2. add migration logic in `runMigrations()`
3. bump schema version via `setSchemaVersion()` path
4. preserve compatibility for existing installs

---

## 8) Review Workflow Model

Review is first-class and stateful.

Typical flow:

1. session turn makes code changes
2. active revision exists (`active`)
3. user creates inline threads
4. publish comments → round becomes `discussing`
5. agent must reply via `review_reply` tool
6. user resolves each thread as:
   - `no_changes`
   - `address_this`
7. once resolved, user can:
   - approve revision, or
   - start next revision (dispatches synthesized “address this” prompt)
8. apply revision / apply and merge

### Write freeze during discussion

In review discussion mode, mutating tools are blocked by extension hook:

- blocked tools: `write`, `edit`, `bash`

If adding new mutating tools, update both:

- `packages/pi-review-extension/src/hooks/discussion-freeze.ts`
- `apps/desktop/src/bun/pi/runtime-manager.ts` (`MUTATING_TOOLS`)

---

## 9) Frontend State and UI Pattern

Zustand stores (`apps/desktop/src/ui/stores/*`):

- `projects-store`
- `sessions-store`
- `conversation-store`
- `review-store`
- `layout-store`
- `settings-store`
- `terminal-store`

Rules:

- prefer functional `set((state) => ...)` updates where previous state is referenced
- hydrate from `SessionHydration` on session open
- process backend push messages in `app.tsx` listener setup

Key UI areas:

- `sidebar` (projects + session list)
- `conversation-pane` (chat, tool cards, checkpoints)
- `diff-pane` (file list, inline threads, revision actions)
- `session-inspector` (checkpoints + session tree)
- `terminal-drawer`
- `settings-dialog`

---

## 10) RPC Change Checklist (Important)

When adding/modifying RPC endpoints, update all layers:

1. **Type contract**: `shared/rpc-schema.ts`
2. **Runtime validation**: `shared/zod-schemas.ts`
3. **Backend handler**: `bun/index.ts`
4. **Service logic**: appropriate service file
5. **UI usage**: store/component calls

For new push messages, also:

- add message type to `rpc-schema.ts`
- validate payload in backend sender path (`bun/index.ts`)
- subscribe/unsubscribe in `ui/app.tsx`
- apply in relevant store(s)

---

## 11) Diff System Notes

- Diff rendering uses `react-diff-view`.
- Keep `@import "react-diff-view/style/index.css"` in `ui/index.css` (required for line coloring).
- `refractor` v5 compatibility requires using `.children` wrapper (already implemented as `refractorCompat` in `diff-pane.tsx`).
- Inline comments anchor to file/side/line/hunk + context (`CommentAnchor`).

---

## 12) Terminal and Platform Notes

- Embedded terminal is disabled on Windows (`supportsEmbeddedTerminal: false`).
- Linux + fish shell may be wrapped with `script(1)` to provide PTY behavior.
- Frontend terminal uses xterm; backend streams via `terminalData`/`terminalExit` messages.

---

## 13) Environment Handling

At app startup, backend resolves login-shell env (`shell-env.ts`) to fix minimal GUI PATH issues (especially macOS).

User-provided `environmentOverrides` are applied before agent session creation.

If working on provider/auth issues, inspect:

- `settings-service.ts`
- `runtime-manager.ts` (override injection)
- `scripts/bundle-bedrock-provider.ts` (lazy provider bundling)

---

## 14) Styling and UX Conventions

- dark theme via CSS vars in `apps/desktop/src/ui/index.css`
- flat macOS-native style (subtle borders/dividers, avoid floating rounded-card overuse)
- fonts are mono-oriented throughout UI (`JetBrains Mono` fallback stack)

If adding new status colors or theme tokens, wire through:

- `models.ts` (`AppSettings`)
- `zod-schemas.ts`
- settings UI
- CSS variables update in `app.tsx`

---

## 15) Known Gotchas

1. **Electrobun != Electron**
2. Root `src/*` is not the active desktop app implementation
3. No automated tests; rely on manual + typecheck
4. DB migrations must preserve existing installs
5. `review_rounds` and session status/review state are coupled; update both carefully
6. Context menu is globally suppressed except approved elements (`data-allow-context-menu`)
7. Keyboard shortcuts in `app.tsx`:
   - Cmd/Ctrl+N: new thread
   - Cmd/Ctrl+,: settings
   - Cmd/Ctrl+J: terminal toggle
   - Cmd/Ctrl+R: review pane toggle

---

## 16) Validation Checklist Before Finishing a Change

Minimum:

```bash
bun run typecheck
```

Recommended for UI/backend changes:

```bash
npx vite build
bun run build
```

Manual smoke:

- open app (`bun run dev:hmr`)
- add/select project
- create/open session
- send prompt and observe streaming
- verify diff pane + revision state transitions
- verify terminal opens (non-Windows)
- verify settings changes persist

For native UI walkthroughs, use:

- `docs/ui-testing.md`

---

## 17) File Ownership Cheatsheet

- App entry (backend): `apps/desktop/src/bun/index.ts`
- App entry (frontend): `apps/desktop/src/ui/main.tsx`
- Root UI composition: `apps/desktop/src/ui/app.tsx`
- Session domain logic: `apps/desktop/src/bun/services/session-service.ts`
- Review domain logic: `apps/desktop/src/bun/services/review-service.ts`
- Pi SDK integration: `apps/desktop/src/bun/pi/runtime-manager.ts`
- Shared contracts: `apps/desktop/src/shared/*`

---

## 18) Agent Operating Principles for This Repo

- Make targeted changes; avoid broad rewrites unless requested.
- Keep type contracts and zod schemas synchronized.
- Preserve backward compatibility for persisted data.
- Prefer explicit, deterministic state transitions.
- Validate with typecheck and at least one manual smoke path.
- If uncertain whether a directory is active, confirm before editing.

---

## Cursor Cloud specific instructions

### Environment

- **Bun** must be on `PATH`. The update script handles installation if missing. After the update script runs, Bun and all npm dependencies are ready.
- **System libraries** required for Electrobun on Linux: `libwebkit2gtk-4.1-0`, `libwebkitgtk-6.0-4`, `libayatana-appindicator3-1`. These are pre-installed in the VM snapshot.
- `LD_LIBRARY_PATH` must include the Electrobun build `bin/` directory (e.g. `/workspace/build/dev-linux-x64/PiGUI-dev/bin`) for `libasar.so` to resolve at runtime. Set this before running `bun run dev:hmr` or `bun run dev`.

### Running the app

- `bun run dev:hmr` starts both Vite (port 5173) and Electrobun with file watching. This is the recommended dev mode.
- The pre-build step (`bun run prebuild:providers`) runs automatically via the `dev:hmr` script.
- On headless Linux, Electrobun may emit non-fatal warnings (`libEGL DRI3`, `X11 GLXBadWindow`, "Application menus not supported on Linux"). These are cosmetic and do not affect functionality.
- No automated test runner or linter is configured. Validation: `bun run typecheck` and `npx vite build`.

### Validation commands (see CLAUDE.md for full list)

- Typecheck: `bun run typecheck`
- Frontend build: `npx vite build`
- Full build: `bun run build`
