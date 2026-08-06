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
