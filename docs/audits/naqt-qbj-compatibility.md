# NAQT and Tournament Schema compatibility notes

Audit date: 2026-08-05

## Current official NAQT guidance consulted

The current NAQT pages were fetched on 2026-08-05. The reporting policy says valid `.yft`, SQBS, and QBJ files are acceptable; exported HTML is not an acceptable submission file. It also requires every game, including unofficial/scrimmage games, forfeits, playoffs, and tiebreakers, and prefers the number of tossups heard for each game. Overtime tossups count toward TUH for the game and each player.

- [NAQT reporting results](https://www.naqt.com/stats/reporting-results.jsp)
- [NAQT using YellowFruit](https://www.naqt.com/stats/using-yellowfruit.html)
- [NAQT explanation of statistics](https://www.naqt.com/stats/explanation.jsp)
- [NAQT official gameplay rules](https://www.naqt.com/rules/), current on August 1, 2026
- [NAQT official electronic scoresheet](https://www.naqt.com/downloads/scoresheet-electronic.xlsx)

The current rules page describes 15-point powers, 10-point tossups, 30-point bonuses, no bonuses in overtime, and a three-tossup initial overtime period followed by sudden-death tossups. The exact standard timed length depends on the tournament audience; the application must preserve the built-in timed/untimed rule sets and must not silently change a stored tournament's scoring rules after games exist.

NAQT's current statistic definitions used in this audit are:

- `TUH` is the number of tossups a team/player had the opportunity to answer.
- `P` is powers; `TU` is regular tossups; `I` is an incorrect interrupt/neg.
- `PPB` is bonus points divided by bonuses heard.
- Under NAQT rules, bonuses heard are correct regulation tossups (`P + TU`) minus correct overtime tossups.
- `PPTUH` is total team points divided by tossups heard; for individuals it uses tossup points.

## Current Tournament Schema / QBJ requirements

The [Tournament Schema documentation](https://schema.quizbowl.technology/) reports version 2.1.1. Its serialization rules require a top-level object with `version` and `objects`, exactly one `Tournament` object, unique object ids, and `$ref` references where used. The schema distinguishes the following data needed for interchange:

- Tournament metadata, site, scoring rules, dates, registrations, phases, rankings, audience/level, and question set.
- Registration → team → player and year/grade relationships.
- Phases with rounds, packets, pools, and pool-team positions.
- Matches with TUH, overtime TUH, location, packet/serial, tiebreaker, carryovers, notes, match teams, player TUH/answer counts, lineups/substitutions, bonus points, bouncebacks, lightning, forfeits, and suppression from statistics.
- Packets and questions, including regular/finals/extra/overtime/replacement/backup/tiebreaker roles.

Relevant pages: [Tournament](https://schema.quizbowl.technology/tournament/), [Registration](https://schema.quizbowl.technology/registration/), [Phase](https://schema.quizbowl.technology/phase/), [Match](https://schema.quizbowl.technology/match/), [Question](https://schema.quizbowl.technology/question/), and [Serialization](https://schema.quizbowl.technology/serialization/).

## Persistent identity audit

`Match.id` is `Match_<counter>~<left team abbreviation><right team abbreviation>`. Only the counter
is stored: `Match.tryToSetId` reads the number back out of a saved id and the rest is recomputed from
whatever the teams are called at the time. That is fine for QBJ and `.yft` serialization, which write
every reference in the same pass and so are always internally consistent, and it is fine for SQBS,
which does not use these ids at all.

It is not fine for one reference: `ScheduledMatch.resultMatchId`. That is YellowFruit's own durable
link from an accepted scheduled game to the authoritative `Match`, it is written once when the result
is accepted, and it is what the correction workflow, the official-result deletion guard, and
`Tournament.acceptedScheduledMatchForResult` all resolve through. Renaming a team moves the id of
every official game that team played, so without reconciliation the link silently stops resolving.

The fix keeps the id format unchanged, because it participates in `.yft` and QBJ references and in
files people already have. Instead, a rename captures the identity of every official `Match` before
committing and rewrites the affected `resultMatchId` values afterwards, as one structural edit
(`src/renderer/Services/TournamentOperationalReconciliation.ts`). Nothing about the statistical
meaning of a past game changes.

Everything else durable was inspected for the same shape — mutable field, computed id, stored
reference:

- `TournamentRoom.id`, `ScheduledMatch.id`, `Tournament.operationalId`: generated once and stored, not
  computed from anything editable.
- `Tournament.seeds` and `PoolTeam.team`: held in memory as object references and serialized to ref
  pointers from current names at save time, so they cannot go stale in memory.
- `ScheduledMatch.leftTeamName` / `rightTeamName` / `poolName` / `phaseCode`: already reconciled by the
  existing structural reconciliation on rename and on phase/round edits.
- `Tournament.rebracketedPhaseCodes` → `Phase.code`: `Phase.code` is computed from phase order and
  type rather than from a user-facing name, and is only recomputed in the phase editor, which already
  refuses the edit when the phase has any non-cancelled scheduled game. No reachable staleness was
  confirmed, so this was left alone; it is recorded here as inspected rather than fixed.

## SQBS compatibility boundary

SQBS is line-oriented legacy interchange. The documented format includes team/player lists; every match's id, team indices, scores/forfeit flag, TUH, round, bonus heard/points, overtime, tossups-without-bonuses, lightning points, 16 player slots with GP/answer counts/points; then conversion/tracking flags, reports, warnings, divisions, point values, packet names, and exhibition statuses.

The exporter at `src/renderer/DataModel/SqbsFileGeneration.ts` is compatibility-critical and must not be casually rewritten. The redesign therefore changes how the exporter is reached, adds golden output checks, and leaves the serialization implementation intact unless a fixture proves a deliberate compatibility fix is necessary.

## Golden fixture obligations

- Create representative timed and untimed NAQT tournaments with 15/10/-5 scoring.
- Include team scores, player answer counts, TUH, bonus heard/points, round numbers, packet names, overtime, a forfeit, standings, and report pages.
- Generate the SQBS output from upstream `v4.0.18` and from the fork; compare normalized meaningful contents and statistics.
- Verify save → reopen preserves the meaningful SQBS output.
- Verify QBJ output contains only schema/persistent statistical data and does not contain room tokens, sessions, presence, or live score state.
- If a real SQBS runtime is available, open the generated files there; otherwise document that external opening was not available and retain the normalized fixture comparison as the automated check.
