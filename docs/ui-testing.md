# UI Testing Guide

This guide documents the native exploratory UI testing workflow for Pi GUI.

The goal is not automated assertions. The goal is to launch the real desktop app, drive it like a user, capture artifacts, and record whether the UI works and makes sense.

## Scope

Use this workflow when you want to:

- test the real Electrobun desktop shell instead of only the browser-rendered UI
- inspect onboarding, empty states, and navigation flow
- verify whether buttons, dialogs, and drawers respond correctly
- capture screenshots for UX review or bug reports

Do not use this as a replacement for service tests or browser smoke tests. It is a manual or agent-assisted review workflow.

## Prerequisites

Install dependencies first:

```bash
bun install
```

Grant both macOS permissions to the app running these commands:

- Accessibility
- Screen Recording

Without Accessibility, `osascript` and System Events cannot inspect or drive the window.

Without Screen Recording, `screencapture` cannot save the live UI for review.

## Launch The App

Start the real desktop app:

```bash
bun run dev
```

In dev mode the app runs under the `bun` process, and the main window title is currently `Pi GUI`.

## Artifact Directory

Store screenshots and notes under:

```bash
mkdir -p output/ui-review
```

## Sanity Checks

Confirm the app is running and visible to macOS automation:

```bash
ps -ax | rg 'Pi GUI|PiGUI|electrobun|main.js'
osascript -e 'tell application "System Events" to get name of every process whose background only is false'
osascript -e 'tell application "System Events" to tell process "bun" to get name of every window'
```

Bring the app window to the front:

```bash
osascript -e 'tell application "System Events" to tell process "bun" to set frontmost to true'
```

Take a baseline screenshot:

```bash
screencapture -x output/ui-review/initial-desktop.png
```

## Inspect The Accessibility Tree

Before clicking around, dump the accessible UI tree. This makes it much easier to discover real button names and visible copy.

```bash
osascript -l JavaScript <<'JXA'
const se = Application('System Events');
const proc = se.processes.byName('bun');
const win = proc.windows.byName('Pi GUI');

function walk(el, depth) {
  let out = [];
  try {
    const role = el.role();
    const title = (el.title && el.title()) || '';
    const value = (el.value && el.value()) || '';
    if ([
      'AXButton',
      'AXRadioButton',
      'AXTextField',
      'AXHeading',
      'AXStaticText',
      'AXGroup'
    ].includes(role)) {
      out.push(`${'  '.repeat(depth)}${role} title=${JSON.stringify(title)} value=${JSON.stringify(value)}`);
    }
    const kids = el.uiElements();
    for (let i = 0; i < kids.length && i < 160; i++) {
      out = out.concat(walk(kids[i], depth + 1));
    }
  } catch (e) {}
  return out;
}

console.log(walk(win, 0).join('\n'));
JXA
```

This is how you discover control names such as `Settings`, `Terminal`, `Add`, `New session`, or drawer tabs like `tools`.

## Click Controls By Accessibility Title

For many controls, `AXPress` works well:

```bash
osascript -l JavaScript <<'JXA'
const se = Application('System Events');
const proc = se.processes.byName('bun');
const win = proc.windows.byName('Pi GUI');

function findButton(el, title) {
  try {
    if (el.role() === 'AXButton' && el.title() === title) return el;
    const kids = el.uiElements();
    for (let i = 0; i < kids.length; i++) {
      const result = findButton(kids[i], title);
      if (result) return result;
    }
  } catch (e) {}
  return null;
}

const button = findButton(win, 'Settings');
if (!button) throw new Error('button not found');
button.actions.byName('AXPress').perform();
console.log('clicked');
JXA
```

Useful examples:

- top bar buttons: `Settings`, `Terminal`, `New session`
- sidebar CTA: `App settings`
- drawer tabs: use `AXRadioButton` and titles like `terminal`, `tools`, `git`

## Fallback: Real Mouse Clicks

Some webview controls expose accessibility metadata but do not respond to `AXPress`.

When that happens:

1. Query the element position and size.
2. Send a real macOS mouse click with CoreGraphics events.

Get the element bounds:

```bash
osascript -l JavaScript <<'JXA'
const se = Application('System Events');
const proc = se.processes.byName('bun');
const win = proc.windows.byName('Pi GUI');

function findButton(el, title) {
  try {
    if (el.role() === 'AXButton' && el.title() === title) return el;
    const kids = el.uiElements();
    for (let i = 0; i < kids.length; i++) {
      const result = findButton(kids[i], title);
      if (result) return result;
    }
  } catch (e) {}
  return null;
}

const button = findButton(win, 'Add');
if (!button) throw new Error('button not found');
console.log(JSON.stringify({
  position: button.position(),
  size: button.size()
}));
JXA
```

Click the center point:

```bash
swift -e 'import Cocoa
let p = CGPoint(x: 412, y: 173)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(50000)
CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)'
```

Use this only when accessibility activation fails. Prefer named controls first because the scripts are easier to maintain.

## Suggested Review Flow

Use a consistent sequence so findings are reproducible.

1. Launch the app with `bun run dev`.
2. Bring the window frontmost.
3. Capture an initial screenshot.
4. Dump the accessibility tree and identify actionable controls.
5. Exercise first-run paths first:
   - `Add`
   - `New session`
   - `App settings`
   - `Settings`
   - `Terminal`
6. After each interaction, capture a screenshot:

```bash
screencapture -x output/ui-review/step-name.png
```

7. Record whether the interaction:
   - worked
   - changed visible state
   - produced a dialog or prompt
   - felt understandable to a first-time user
8. Stop the app when done with `Ctrl+C`.

## What To Evaluate

Focus on product behavior and clarity, not just whether a click technically registers.

Good review categories:

- Onboarding: Can a new user tell what to do first?
- CTA clarity: Are the important actions visible, labeled well, and obviously enabled or disabled?
- Empty states: Do empty panes explain why they are empty and what the next step is?
- Navigation: Do top-bar controls, sidebars, drawers, and tabs behave predictably?
- Redundancy: Are duplicate actions intentional and clear?
- Feedback: When an action fails or is unavailable, is that communicated?
- Density: Does the layout feel balanced, or is too much of the window empty?

## Known Caveats

- Browser testing against `http://localhost:5173` is useful for rendering checks, but it does not fully represent the native Electrobun shell.
- In dev mode the desktop app is surfaced through the `bun` process, so process targeting should use `bun`, not `Pi GUI`.
- Some accessible controls may expose titles and focus state but still fail to respond to `AXPress`.
- If a control is enabled but produces no visible change, capture before and after screenshots and treat it as a UI finding until proven otherwise.

## Example Findings Format

Keep findings short and concrete:

```md
- `Add` is visible and focusable on first run, but clicking it produced no visible prompt or state change.
- `New session` appears enabled with no selected project, but it did not communicate why it could not proceed.
- `Settings` opened correctly and the General tab content was readable and well-labeled.
- The terminal drawer toggled open and closed, but the empty state provided little explanation of what the tabs represent.
```

## Cleanup

Shut down the running dev app:

```bash
# Press Ctrl+C in the bun run dev terminal
```

If you created screenshots, keep them under `output/ui-review/` so other reviewers can inspect the same artifacts.
