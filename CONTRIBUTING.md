# Contributing to Fruity

Thanks for wanting to help. Fruity is a fork of [YellowFruit](https://github.com/ANadig/YellowFruit) that adds
tournament-day scheduling, browser scoring, room management, and live displays. Bug reports, testing on real
tournaments, and code are all welcome.

## Where a change belongs

Three repositories are involved, and picking the right one saves everyone a round trip.

| Change | Repository |
| --- | --- |
| Statkeeping, reports, QBJ/SQBS/`.yft` files, scheduling, Match Plan, Tournament Control, rooms, live display | this one |
| A bug that also reproduces in stock YellowFruit and has nothing to do with fork features | consider reporting it to [`ANadig/YellowFruit`](https://github.com/ANadig/YellowFruit) as well |
| The QBTCP protocol, the QBJ assignment profile, or the QBSheet browser scorer itself | [`gbyo/qbsheet`](https://github.com/gbyo/qbsheet) |

Fruity is one QBTCP implementation; it does not define the protocol. A change to the wire surface usually needs a
matching change to the specs in `gbyo/qbsheet` — see [Protocol and file-format changes](#protocol-and-file-format-changes).

## Reporting bugs

Open a GitHub Issue and pick the form that fits — bug report, feature request, or question. The forms ask for what
a maintainer needs to reproduce something:

* what you expected and what happened
* steps to reproduce
* your OS, and the Fruity version (**Help → About**) or the commit you built from
* for room/browser scoring problems: which target was involved (desktop app, room browser, live display), the
  device and browser in the room, and whether the Local Tournament Server was running

**Never paste room access tokens, session tokens, or pairing codes into a public issue**, and scrub rosters if the
tournament data is not already public. If a token is the only way to explain the bug, say so and leave it out.

## Getting set up

You need Node.js and npm. CI builds on Node 22, so that is the safest version to develop against.

```sh
git clone https://github.com/gbyo/fruity.git
cd fruity
npm install
```

`npm install` runs a `postinstall` step that checks native dependencies, rebuilds Electron's app deps, and builds
the development DLL bundle. It is slow the first time; that is expected, not a hang.

Run the app in development:

```sh
npm start
```

If you are tracking upstream YellowFruit, the conventional remote layout is `origin` for this fork and `upstream`
for `ANadig/YellowFruit`.

## Repository layout

Everything ships from `src/`, and webpack builds four separate targets:

| Target | Source | What it is |
| --- | --- | --- |
| `main` | `src/main/` | Electron main process, file I/O, backups, the Local Tournament Server |
| `renderer` | `src/renderer/` | the Fruity desktop app |
| `room` | `src/room/` | the browser room client and first-party scorer |
| `live` | `src/live/` | public pairings and the live display |

Some places worth knowing before you start editing:

* `src/renderer/DataModel/` — the tournament model, plus QBJ, SQBS, and `.yft` parsing and generation.
* `src/renderer/TournamentManager.ts` — the desktop app's central state and command surface.
* `src/main/server/` — the tournament server: `Router.ts` (QBTCP routes), `RoomPairing.ts`, `SessionStore.ts`,
  `QbtcpAssignment.ts`, presence and help-request stores.
* `src/room/scoring/` — score events and the reducers that derive a game from them; `src/room/scorer/` is the UI
  over that.
* `src/shared/` — types crossing the main/renderer/room/live boundary.
* `src/__tests__/` — all tests.
* `docs/audits/` — parity and redesign audits. If you are making a broad change, read the relevant one first; if
  your change invalidates a claim in one, update it.

Two architectural invariants hold across the fork, and changes should preserve them:

* **The desktop application is the tournament authority.** A room submission is not an official result until
  tournament control accepts it.
* **The assignment a room receives over the network is the same QBJ document Fruity could have written to disk.**
  The connected and file-based paths must not drift apart.

## Before you open a pull request

Run the same four checks CI runs, in this order:

```sh
npm run lint
```

```sh
npm run typecheck
```

```sh
npm test -- --run
```

```sh
npm run build
```

`npm run typecheck` is not redundant with the build: the webpack builds run `ts-loader` with `transpileOnly`, so
`tsc -p tsconfig.typecheck.json` is what actually checks types. CI (`.github/workflows/ci.yml`) runs all four on
every push and pull request.

## Tests

Tests are Vitest, and live in `src/__tests__/` matching `**/*.test.{ts,tsx}`.

```sh
npm test -- --run          # once, like CI
npm test                   # watch mode
npm test -- --run Room     # only files matching "Room"
```

Notes on conventions here:

* The default environment is node. Component tests opt into jsdom with a `@vitest-environment jsdom` docblock at
  the top of the file, so the several hundred node-environment tests stay fast.
* Shared fixtures live in `src/__tests__/TestFixtures.ts` and the various `*TestHarness.ts` / `*Fixtures.ts`
  helpers. Prefer extending those over inventing a parallel set.
* Server tests run a real server on a real socket rather than mocking the transport. Keep it that way for
  anything protocol-shaped — that is what catches route drift.
* For realistic QBJ, YFT, SQBS, recovery, and report fixtures, follow
  [`docs/TEST_FILE_GENERATION.md`](https://github.com/gbyo/qbsheet/blob/main/docs/TEST_FILE_GENERATION.md) in the
  QBSheet repository instead of hand-writing files.
* A file's header comment should say what claim the tests protect, not just what module they cover. Existing
  tests do this and it makes failures much easier to triage.
* `npm run jesttest` still exists alongside the legacy Jest config in `package.json`. Vitest is the runner CI
  uses; add new tests there.

New behavior needs a test. Bug fixes need a test that fails before the fix.

## Manual verification for tournament-day features

Some of the fork's surface cannot be fully covered by unit tests. If you touch it, say in the pull request what you
exercised by hand:

* **Room scoring** — pair a second device (or a second browser profile) against the Local Tournament Server, score a
  game, submit it, and accept it in Tournament Control. `npm run room:harness` drives the room client without a full
  tournament if you only need the scorer.
* **Recovery paths** — stop the server, or disconnect the room device, mid-game. The room must keep scoring and the
  result must survive.
* **Live display and public pairings** — check that unreleased rounds stay unpublished.

## Code style

* TypeScript throughout; `.tsx` for components. React with Material UI on the desktop side.
* Prettier settings live in the `prettier` block of `package.json` (single quotes, 120-column width). Indentation,
  line endings, and final newlines come from `.editorconfig`. Run Prettier before committing.
* ESLint extends `erb` with the overrides in `.eslintrc.js`. `npm run lint` must be clean of new warnings.
* Match the surrounding code. This codebase comments the *why* — the invariant a function protects, the reason a
  path exists — rather than restating the code, and new code should read the same way.

## Commits and pull requests

* Branch off `master`. Branch names in this repo look like `topic/short-description` (for example
  `gibby/qbtcp-qbj-fruity`); anything descriptive is fine.
* Write commit subjects in the imperative mood — "Serve QBTCP v1, with /api/v1 as deprecated aliases". A
  conventional-commit prefix (`feat:`, `fix:`, `docs:`, `chore:`) is common but not required.
* Keep a pull request to one concern. The tournament-day surface has a lot of coupling, and small reviewable
  changes are much easier to land than a broad pass.
* The pull request template walks through what to include: what changed, how it was tested, which of the four
  targets it touches, and the tournament-day risk. Delete the sections that do not apply — an untouched wire
  surface does not need the protocol checklist.
* For anything touching rooms, the server, recovery, or file formats, say what could break for a director who is
  mid-tournament on an older build, or who has files written by one.
* CI must be green before merge.

## Protocol and file-format changes

Extra care applies to anything that crosses a boundary:

* **QBTCP routes.** `/qbtcp/v1` is canonical; `/api/v1` remains as deprecated aliases onto the same handlers so
  scoresheets deployed before the migration keep working. Add both, never a second implementation — the point of
  the aliasing is that a fix to one is a fix to both.
* **Assignments.** An exported `*.assignment.qbj` must stay free of room credentials, server URLs, and any other
  room's game. The QBJ assignment profile in `gbyo/qbsheet` governs which fields an assignment uses.
* **Tournament files.** `.yft`, QBJ, and SQBS are read by other tools and by older Fruity builds. Reading a file
  written by an older version must keep working, and round-trip coverage is expected for changes here. Fruity no
  longer writes `.qbg` but still imports it.
* **The `qbsheet` dependency** is pinned to a specific commit in `package.json` (`git+https://…#<sha>`). Bump that
  SHA in its own commit, with a note about what changed on the QBSheet side, so a scorer regression can be
  bisected independently of Fruity changes.
* Specs are not restated in this repository. Change them in `gbyo/qbsheet`
  ([`QBTCP.md`](https://github.com/gbyo/qbsheet/blob/main/docs/QBTCP.md),
  [`QBJ_ASSIGNMENT_PROFILE.md`](https://github.com/gbyo/qbsheet/blob/main/docs/QBJ_ASSIGNMENT_PROFILE.md)) and link
  the two pull requests to each other.

## Security

Do not open a public issue for a vulnerability in the tournament server, pairing, or session handling. Report it
privately to the maintainers first — a running tournament is a live LAN service with real devices attached to it.

## License

Fruity is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). By contributing, you agree
your contribution is licensed under the same terms.
