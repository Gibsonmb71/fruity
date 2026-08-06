# Game / Match Editor redesign checklist

This checklist is derived from the attached Game / Match Editor brief. An item is complete after
the behavior is implemented and verified in the relevant automated workflow. Optional Electron
visual checks are tracked separately and are not blockers for the code-only implementation.

## Discovery and boundaries

- [x] Read the complete brief and audit the current worktree.
- [x] Compare the current editor with upstream YellowFruit 4.0.18 behavior.
- [x] Keep tournament/statistics business logic in the existing data model and `TempMatchManager`.
- [x] Keep manual YellowFruit match entry independent of Tournament Server and scheduled matches.

## Match details and team composition

- [x] Compact match-details header with round, derived stage, TU read, and conditional carryover.
- [x] Clear Add/Edit title and scheduled/location context when it exists.
- [x] Two mirrored team panels are the visual center of the dialog.
- [x] Team selector, score, forfeit, players, bonuses, bouncebacks, and lightning stay together.
- [x] Forfeit state is explicit and irrelevant stats inputs do not leave large empty grids.

## Player score sheet

- [x] Semantic compact player table with dynamic answer-type columns.
- [x] Numeric alignment, compact entry controls, stable focus, and natural Tab order.
- [x] Enter commits fields without disrupting normal multiline notes entry.
- [x] Derived player points are read-only display values.
- [x] Player drag reorder remains available with a clearly associated handle.
- [x] Accessible move-up/move-down alternative is available.
- [x] Obsolete `MuiGrid2` selectors and layout hacks are removed.

## Scoring features

- [x] Structured bonus summary per team.
- [x] Conditional bounceback section with existing calculations and validation.
- [x] Conditional lightning/worksheet section with existing calculations and validation.
- [x] Ruleset-aware field composition for standard and custom scoring.
- [x] Contextual overtime disclosure and dynamic overtime answer-type table.
- [x] Existing overtime validation, custom scoring, and forfeit behavior remain intact.
- [x] Notes stay available through a compact expandable editor with usable multiline input.

## Validation and actions

- [x] Persistent compact validation summary near the sticky footer.
- [x] Existing field-level validation remains local.
- [x] Validation summary entries focus/highlight actionable fields where possible.
- [x] Ordinary save validation keeps the editor open instead of opening a duplicate modal.
- [x] Warning suppression remains explicit; errors are never newly suppressible.
- [x] Ignored-warning count and Restore action are understandable.
- [x] Sticky footer uses Cancel, Save & New, and Save Game task verbs.
- [x] Alt+C, Alt+S, and Alt+A remain compatible.
- [x] Save & New validates, saves, resets correctly, preserves round, and focuses the next entry.
- [x] New versus existing editing actions are clear without disrupting expert workflow.

## Layout and organization

- [x] Desktop dialog uses available space without arbitrary content heights.
- [x] Team panels stack safely at narrow supported widths without unusable numeric cells.
- [x] Presentation is split into focused components with manager-owned business logic.
- [x] Light/dark styling follows the redesigned application theme tokens in code.

## Regression and verification

- [x] Round selection, non-numeric rounds, derived stage, and carryover stages.
- [x] Timed and untimed TU read behavior, including automatic TUH and non-default timed TUH.
- [x] Team selection, score entry, answer types, player TUH, answer counts, points, and reorder.
- [x] Bonuses, PPB, forfeit wins/losses, bouncebacks, lightning, overtime, and notes.
- [x] Warning suppression/restoration, duplicate-team, already-played, pool, and stat validation.
- [x] Save, Save & New, Cancel, add, edit, keyboard shortcuts, and keyboard-only entry paths.
- [x] Realistic NAQT untimed and timed cases.
- [x] Custom ruleset case with extra answer types, bonuses, bouncebacks, lightning, and overtime.
- [x] Complete lint, typecheck, test, and production build suite for the code-only goal.
- [ ] Optional Electron visual QA at 1200x728, 1440x900, narrow desktop, light, and dark.
- [ ] Optional manual five-game Save & New workflow pass for invalid data, suppression, overtime,
      and forfeit.
- [x] Original YellowFruit, traditional manual, Tournament Server, and NAQT parity reviewed in code
      and automated coverage.

## Broader tournament workflow checklist

- [x] Preserve traditional YellowFruit workflow and the optional room/server workflow.
- [x] Simplify Control / Live and show current versus next room semantics.
- [x] Add Match Plan filters, round board drag/drop, unassigned lane, safe swaps, auto-assign, and rebalance preview.
- [x] Group operational issues and make readiness actions task-specific.
- [x] Add rebracketing flow, scoped reports, NAQT readiness, and resume-state navigation.
- [x] Add setup preflight, network selection, connection testing, Quick Find, and deep Games navigation.
- [x] Clean header and dead Match Plan renderer/CSS paths.

## Optional future QA

Electron visual/workflow checks remain useful follow-up coverage, but they are intentionally not
required to complete this code-only implementation goal.
