# Custom AI Summary Instruction — Design

**Date:** 2026-04-28
**Status:** Approved
**Owner:** Kelvin Nyadzayo

## Problem

PagePulse v1.2.3 generates AI summaries using a fixed closing instruction:

> *"In one sentence, plain English, what meaningfully changed? Skip cosmetic differences. Lead with the most important fact."*

Users monitor different kinds of pages (job listings, prices, news, government docs) and want the summary tailored — sometimes a tweet-length quip, sometimes just the new price in dollars, sometimes a 5-word headline. There is no way to customize the instruction today.

## Goal

Let users:
1. Set a global default instruction in the AI configuration dialog.
2. Optionally override it per monitor in the monitor detail panel.

Manual-only generation (1.2.3) is unchanged. Custom instruction applies whether the user clicks "Generate AI summary" once or a thousand times.

## Non-goals

- **Full prompt templating** (placeholders, system messages). Approach B/C from the brainstorm. Can be added later behind an advanced toggle.
- **Preset chip library.** Static hint text below each textarea suffices.
- **Instruction validation.** Trust the user; bad prompts produce weird summaries, which the user sees and fixes.
- **Cost estimation per monitor.** Out of scope.

## Schema

| Field | Where stored | Default | Notes |
|---|---|---|---|
| `settings.aiSummaryInstruction` | `chrome.storage.local` settings object | `""` | Empty falls back to built-in `DEFAULT_INSTRUCTION`. |
| `monitor.aiSummaryInstruction` | per-monitor record | `""` | Empty falls through to global. NOT included in `SYNCABLE_FIELDS` (kept local — instruction may contain personal phrasing the user doesn't want synced). |

**Resolution rule (computed at generate time, not stored):**

```
effective = monitor.aiSummaryInstruction
         || settings.aiSummaryInstruction
         || DEFAULT_INSTRUCTION
```

`DEFAULT_INSTRUCTION` is the current closing line, exported as a constant from `src/lib/aiSummary.js`.

**Decision (unsync):** `aiSummaryInstruction` does not sync via `chrome.storage.sync`. Same rationale as `aiApiKey` — instructions may include personal/business context the user doesn't want replicated.

## Function changes (pure)

### `buildSummaryPrompt(monitor, change, instruction?)`

Third optional parameter. Behaviour:

- `instruction === undefined` or empty/whitespace → use `DEFAULT_INSTRUCTION`.
- Non-empty string → use it verbatim as the closing instruction line.

The boilerplate framing (`A webpage I am monitoring titled "..."`, `Old text:` / `New text:` blocks) is unchanged.

### `summarizeChange(monitor, change, opts)`

Accepts `opts.instruction`. Passes it to `buildSummaryPrompt`. No other contract change.

## UI changes

### AI configuration dialog (existing)

New `<textarea>` below the API Key input, before the action buttons:

- Label: `Custom instruction (optional)`
- Placeholder: `In one sentence, plain English, what meaningfully changed? Skip cosmetic differences. Lead with the most important fact.`
- Hint below: `Replaces the closing instruction line. Empty = use the built-in.`
- Examples (static hint, monospace, dim color): four lines listing the templates from the brainstorm.

Saved to `settings.aiSummaryInstruction` on dialog Save (alongside the existing fields).

### Monitor detail panel

New `<textarea>` after the existing "Webhook" field:

- Label: `AI prompt override (optional)`
- Placeholder: `(global instruction is used)`
- Hint: `Overrides the global instruction for this monitor only.`

Saved to `monitor.aiSummaryInstruction` on blur via `updateMonitor`. Same pattern as the keywords / ignorePatterns fields.

### Generate-button click flow

In `dashboard.js` history click handler for `.dm-ai-gen-btn`:

```
const settings = await getSettings();
const monitor = (await getMonitors())[currentMonitorId];
const effective = (monitor.aiSummaryInstruction || settings.aiSummaryInstruction || '').trim() || undefined;
await summarizeChange(monitor, entry, { ..., instruction: effective });
```

Passing `undefined` lets `buildSummaryPrompt` take the documented fall-through path to the constant default — single source of truth.

### AI button visibility (separate concern, bundled)

The header "AI" button currently uses the `theme-toggle` class which is icon-only. Users have reported low discoverability.

Change: keep the icon, add a visible text label `Configure AI` (or `AI Off` / `AI On` based on state) inline next to the icon. Drop `theme-toggle` class for this button; introduce `header-text-btn` style with padding for an icon + label combo. Sync and sound buttons stay icon-only (well-understood affordances).

The button's behaviour is unchanged: click toggles AI on/off (re-validating host permissions when re-enabling); click while OFF without configuration opens the dialog.

## Tests (TDD)

New tests in existing files:

- `tests/lib/aiSummary.test.js`:
  1. `buildSummaryPrompt(monitor, change)` (no instruction) — produces the same output as today (regression guard).
  2. `buildSummaryPrompt(monitor, change, '')` — empty falls back to default.
  3. `buildSummaryPrompt(monitor, change, '   ')` — whitespace-only falls back to default.
  4. `buildSummaryPrompt(monitor, change, 'Output the new price in dollars only.')` — closing line replaced verbatim. Boilerplate unchanged.
  5. `summarizeChange` with `opts.instruction: 'X'` — request body's user message contains `'X'` (asserted via `JSON.parse(opts.body).messages[0].content`).
  6. Exported constant `DEFAULT_INSTRUCTION` exists, equals current closing line.

- `tests/lib/monitor.test.js`:
  7. `MONITOR_SCHEMA_DEFAULTS.aiSummaryInstruction === ''`
  8. `makeMonitor` accepts `input.aiSummaryInstruction` and persists it.
  9. `migrateMonitor` backfills missing `aiSummaryInstruction` to `''`.

- `tests/lib/configSync.test.js`:
  10. `selectSyncableFields(monitor)` — assert `aiSummaryInstruction` is NOT in the returned object (privacy guard).

UI wiring is glue, not unit-tested.

## Implementation order

1. Add `DEFAULT_INSTRUCTION` constant + `aiSummaryInstruction` field to `MONITOR_SCHEMA_DEFAULTS` and `DEFAULT_SETTINGS`. Tests #6, #7, #8, #9, #10.
2. Modify `buildSummaryPrompt` signature and add `summarizeChange.opts.instruction` plumbing. Tests #1–#5.
3. Wire the dashboard generate-button click handler to compute and pass the effective instruction.
4. Add the AI dialog textarea with save handler.
5. Add the per-monitor textarea with blur-save handler.
6. Rename the header AI button to show text label `Configure AI` / `AI On` / `AI Off`. Drop `theme-toggle` class for that one button.
7. Bump version to 1.3.0 (minor — schema additions and visible new feature). Build dist. Commit.

## Risks

- **Token cost surprise.** A user pastes a verbose 2,000-character instruction and uses it on every monitor → bigger summary requests. Mitigation: `buildSummaryPrompt` already truncates `old`/`new` to 800 chars each; instruction itself is bounded only by user input. Acceptable — manual generation gives them control.
- **Bad instruction → bad summary.** Mitigated by the manual-generate workflow: user sees the result immediately, edits prompt, regenerates. Self-correcting loop.
- **Sync exclusion regression.** A future change to `SYNCABLE_FIELDS` that accidentally includes `aiSummaryInstruction` would leak personal phrasing across devices. Test #10 guards against this.

## Acceptance criteria

- [ ] All 10 new tests pass.
- [ ] AI dialog has the custom instruction textarea, populated from settings, saving on dialog Save.
- [ ] Monitor detail panel has the AI prompt override textarea, populated from monitor, saving on blur.
- [ ] Clicking "Generate AI summary" uses the effective instruction; verify by setting per-monitor override to `Output: PRICE_TEST` and confirming the API request contains it.
- [ ] Header AI button shows `Configure AI` text alongside the icon when AI is off, `AI On` when on.
- [ ] Existing 232 tests still pass.
- [ ] Version 1.3.0 in manifest and package; dist rebuilt; commit message references this design doc.
