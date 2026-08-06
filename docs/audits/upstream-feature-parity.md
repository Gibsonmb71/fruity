# YellowFruit upstream feature-parity checklist

Audit date: 2026-08-05

## Comparison scope

- Fork under audit: `gibby/ux-redesign` at `20409dfb`.
- Fork baseline branches: local `master` at `9380c35f` and the fork's current working tree.
- Upstream reference: `ANadig/YellowFruit` tag `v4.0.18` at `3f9113096839d4e3c944adee33366e8ebde77b75`.
- Existing test baseline: 30 Vitest files, 446 tests passing; typecheck passing; lint has one pre-existing `no-console` warning in `src/renderer/DataModel/CaseConversion.ts`.

The fork is a source-level superset of the upstream tag. Its additional functionality is concentrated in the local tournament server, browser room clients, public live display, scheduled-match model, room allocation/policy services, rebracketing controls, and recovery tests. The redesign must preserve those additions as well as every upstream capability below.

## Capability matrix

Status before the redesign is intentionally recorded here, before implementation changes. `Present` means the capability is available in the fork today; `Protect` means the redesign must keep its existing data path and tests. Rows marked `Add regression` are coverage obligations for this pass, not known functional gaps.

| Capability | Upstream path / fork path | Baseline status | Regression obligation |
| --- | --- | --- | --- |
| New tournament | `TournamentManager.newTournament`, File menu | Present / Protect | Add lifecycle smoke coverage |
| Open `.yft` | `TournamentManager.openYftFile`, `FileParsing` | Present / Protect | Save/reopen fixture |
| Save / Save As | `TournamentManager.saveYftFile`, `yftSaveAs` | Present / Protect | Save/reopen fixture |
| Autosave / recovery backup | `saveBackup`, `parseBackup`, recovered-backup UI | Present / Protect | Keep recovery state out of public/QBJ/SQBS exports |
| Old `.yft` migration/loading | `OldYfParsing`, `earlyYftFileConversions` | Present / Protect | Existing conversion tests remain green |
| QBJ tournament import/export | `FileParsing`, `QbjUtils`, menu IPC | Present / Protect | QBJ fixture round-trip |
| QBJ team/roster import | `TournamentManager.importQbjTeams` | Present / Protect | Existing import tests remain green |
| QBJ game import | `MatchImportService`, `QbjMatchNormalizer` | Present / Protect | Existing import tests remain green |
| SQBS team/roster import | `SqbsParsing` | Present / Protect | Existing parser tests remain green |
| SQBS export | `SqbsFileGeneration`, `SqbsExportDialog` | Present / Protect | Add timed/untimed golden fixtures |
| HTML stat reports | `HTMLReports`, `StatReportPage` | Present / Protect | Report pages and readiness scope coverage |
| Standard/custom scoring rules | `ScoringRules`, rule settings cards | Present / Protect | Standard ruleset mapping coverage |
| NAQT timed | `CommonRuleSets.NaqtTimed` | Present / Protect | Golden NAQT fixture |
| NAQT untimed | `CommonRuleSets.NaqtUntimed` | Present / Protect | Golden NAQT fixture |
| ACF | `CommonRuleSets.Acf` | Present / Protect | Standard ruleset mapping coverage |
| ACF / mACF powers | `CommonRuleSets.AcfPowers` | Present / Protect | Standard ruleset mapping coverage |
| Tossup values | `AnswerType`, match validation/stats | Present / Protect | 15 / 10 / -5 statistics |
| Negs / interrupts | `AnswerType`, `MatchPlayer`, stats | Present / Protect | 15 / 10 / -5 statistics |
| Bonuses | `MatchTeam`, bonus settings, stats | Present / Protect | Team bonus heard/points and PPB |
| Bouncebacks | `MatchTeam`, rules/settings, SQBS generator | Present / Protect | Custom rules and SQBS encoding |
| Overtime | `Match`, overtime settings, normalizer | Present / Protect | TUH and PPB-compatible overtime |
| Lightning / worksheet scoring | lightning settings, `MatchTeam`, reports/SQBS | Present / Protect | Keep non-NAQT pathways available |
| Team statistics | `StatSummaries`, `HTMLReports` | Present / Protect | Reports fixture |
| Player statistics | `StatSummaries`, `HTMLReports` | Present / Protect | Reports fixture |
| TUH | `Match`, `MatchPlayer`, reports/SQBS | Present / Protect | Timed/untimed fixture and save/reopen |
| Forfeits | `Match`, validation, reports/SQBS | Present / Protect | Export and report coverage |
| Phases | `Phase`, `PhaseEditDialog`, schedule/teams UI | Present / Protect | Lifecycle navigation must retain access |
| Pools / divisions | `Pool`, pool assignment and phase UI | Present / Protect | Format and rebracketing workflow |
| Carryovers | `Match.carryoverPhases`, `SqbsFileGeneration` | Present / Protect | SQBS scope/phase fixture |
| Rebracketing | `TournamentManager.rebracketPool`, rooms rebracket dialog | Present / Protect | Control entry point plus existing tests |
| Tiebreaker stages | phase minor phases / `addTiebreakerAfter` | Present / Protect | Format custom editing |
| Finals | `addFinalsPhase`, finals reports | Present / Protect | Format and report coverage |
| Standard schedule templates | `StandardSchedule`, `ScheduleUtils`, templates | Present / Protect | Format chooser shortcut |
| Completely custom tournament formats | `SchedulePage`, phase/pool dialogs | Present / Protect | Advanced format controls remain discoverable |
| Seeding | teams seeding view and `TournamentManager` seed methods | Present / Protect | Setup Teams subview |
| Manual ranks/final rankings | ranks view, `RankEditDialog`, final-rank controls | Present / Protect | Setup Teams subview and reports |
| SS / JV / UG / D2 tracking | general tracking settings, registrations/players | Present / Protect | Setup Tournament and Teams |
| Packet names | `Round`, General settings, SQBS/reports | Present / Protect | Match plan/report fixture |
| Match validation | `MatchValidationMessage`, `Match`, `MatchEditDialog` | Present / Protect | Inline-readable warnings and dismissals |
| Dismissible/suppressible warnings | validation collections and YFT serialization | Present / Protect | Unified issue counts must distinguish suppressed warnings |
| Keyboard shortcuts | main menu, `react-hotkeys-hook`, modal helpers | Present / Protect | Navigation and Games fast path |
| Manual match entry | `MatchEditDialog`, `TournamentManager` | Present / Protect | Games fast path |
| Game filtering | `GamesPage` team filter and views | Present / Protect | Games tabs/filter preserved |
| Player stats / substitutions | `MatchEditDialog`, `MatchPlayer`, lineups | Present / Protect | Games entry remains reachable |
| Overtime / lightning / notes / carryovers in game editing | `MatchEditDialog`, `Match` data model | Present / Protect | Games entry remains reachable |
| All existing report pages | standings, individuals, scoreboard, team/player details, round report | Present / Protect | Reports tabs expose every page |
| Local room server and recovery | `TournamentServerService`, `main/server`, `SessionStore` | Fork addition / Protect | Control workflow tests |
| Browser room scoring clients | `src/room` | Fork addition / Protect | Production room build |
| Public live website/slideshow | `src/live`, `PublicLiveSnapshot` | Fork addition / Protect | Public snapshot excludes ephemeral state |
| Scheduled matches and room allocator | `ScheduledMatch`, `ScheduleService`, allocation services | Fork addition / Protect | Match Plan and Control tests |

## Redesign guardrails

1. Navigation labels may change (`General` becomes `Tournament`, `Schedule` becomes `Format`, `Rooms` becomes `Control`), but the underlying upstream data model and operations remain available.
2. `Match` remains the authoritative accepted statistical result. `ScheduledMatch` remains planning/operations state and must not be substituted into reports.
3. `.yft` remains the persistent YellowFruit file, QBJ remains interchange, SQBS remains legacy/NAQT-compatible statistics interchange, and server recovery/session/presence/live tossup state remains ephemeral.
4. Room tokens, sessions, presence, and live score state must not enter public exports or QBJ/SQBS output.
5. A standard ruleset is a shortcut to the existing full rules configuration. Custom controls remain available and standard rulesets remain reversible until match data locks the scoring rules.
