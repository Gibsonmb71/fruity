<h1 align="center">
  Fruity 🍌
</h1>

<p align="center">
  <strong>More than a stats app.</strong>
</p>

<p align="center">
A YellowFruit fork built for tournament-day scheduling, browser scoring, room management, and live displays.</p>

<p align="center">
  <a href="https://github.com/Gibsonmb71/fruity/releases">Releases</a>
  ·
  <a href="https://github.com/Gibsonmb71/fruity/issues">Issues</a>
  ·
  <a href="https://github.com/ANadig/YellowFruit">YellowFruit</a>
  ·
  <a href="LICENSE">License</a>
</p>

---

Fruity is a fork of [YellowFruit](https://github.com/ANadig/YellowFruit) built for running quiz bowl tournaments from one place. It keeps YellowFruit's statkeeping, tournament files, reports, QBJ, and SQBS support while adding scheduling, browser-based MODAQ scoring, room management, public displays, and tournament-day control.

## Features

* **Tournament setup** — teams, scoring rules, stages, pools, rounds, carryovers, and rebracketing.
* **Match Plan** — schedule matchups, assign rooms, auto-assign unassigned games, and rebalance future rounds.
* **Browser scoring** — score games from Chromebooks and other devices using MODAQ.
* **Easy room pairing** — connect room devices with a QR code or 8-digit pairing code.
* **Tournament Control** — monitor rooms, readiness, active games, submitted results, and issues.
* **Result review** — accept or reject room submissions before they become official.
* **Room operations** — help requests, hold new starts, room reassignment, and connection status.
* **Public pairings** — publish the currently released round so teams can find their opponent and room.
* **Live Display** — show standings, individual statistics, accepted results, and released pairings.
* **Reports & exports** — HTML statistics, QBJ, SQBS, and standard `.yft` tournament files.

## Browser scoring

Fruity can run a local Tournament Server from the control computer. Room devices pair once and stay assigned to their room throughout the tournament.

```text
Fruity
  ↓
Match Plan
  ↓
Room browser
  ↓
MODAQ
  ↓
Submit result
  ↓
Tournament Control
  ↓
Accept
  ↓
Official statistics
```

The desktop application remains the tournament authority. A room submission does not become an official result until tournament control accepts it.

Room browsers can also report when they are ready, request help from tournament control, and continue showing their assigned game during temporary connection problems.

### QBSheet browser scorer

The first-party browser scorer also has a static, offline-first distribution in the separate
`gbyo/qbsheet` repository. Fruity remains the tournament authority and can provide either
of the following workflows:

* **Connected** — configure QBSheet's HTTP(S) origin in Tournament-day settings, start
  the Local Tournament Server, and let the scorekeeper pair normally. The origin is a CORS allowlist
  entry only; room and session tokens still authenticate every room operation.
* **File-based** — from Match Plan, release the round and choose **Export room scoring files**. Fruity
  writes one `*.assignment.qbj` per playable room assignment: an official QBJ document holding one
  unplayed scheduled match, its two teams and rosters, and the tournament's scoring rules — but no
  room credentials, no server URL, and no other room's game.

Both workflows carry the **same** document. The assignment served over the network is the one Fruity
could have written to disk, and QBSheet parses both with one reader, so the connected and offline
paths cannot drift apart.

The formats and the protocol are specified in the QBSheet repository rather than restated here:

| Specification | Covers |
| --- | --- |
| [`docs/QBTCP.md`](https://github.com/gbyo/qbsheet/blob/main/docs/QBTCP.md) | **QBTCP**, the Quiz Bowl Tournament Control Protocol — an application-layer HTTP/JSON protocol between scoresheets and tournament-control software. Discovery, pairing, assignment delivery, progress, results, recovery, CORS/LAN, security model. |
| [`docs/QBJ_ASSIGNMENT_PROFILE.md`](https://github.com/gbyo/qbsheet/blob/main/docs/QBJ_ASSIGNMENT_PROFILE.md) | Which QBJ fields an assignment uses, the small `_qbtcp` extension, graceful degradation, privacy rules, filename conventions. |
| [`docs/QBG_MIGRATION.md`](https://github.com/gbyo/qbsheet/blob/main/docs/QBG_MIGRATION.md) | Retiring the legacy `.qbg` package, and the `/api/v1` → `/qbtcp/v1` route mapping. |
| [`docs/TEST_FILE_GENERATION.md`](https://github.com/gbyo/qbsheet/blob/main/docs/TEST_FILE_GENERATION.md) | How developers and coding agents generate realistic QBJ, YFT, SQBS, QBG, recovery, and report fixtures. |

Fruity is one QBTCP implementation and QBSheet is another; neither defines the protocol. Fruity
serves the canonical `/qbtcp/v1` routes and keeps its existing `/api/v1` routes as deprecated
aliases onto the same handlers, so scoresheets deployed before the migration keep working. Fruity no
longer writes `.qbg` files; it still imports them.

QBSheet scores locally in either mode and always produces a portable QBJ. Connected
games can send a result to Fruity automatically, but the scorekeeper still downloads and hands over
the QBJ as an independent backup. Fruity can import that QBJ later: an identical result is treated
as confirmation, while a differing result or an older assignment revision is held for director
review. Google Drive, a network folder, USB storage, or email may carry the files; none is a protocol
dependency.

QBSheet's configured value is an origin such as `https://example.github.io`, not a
GitHub Pages repository path. A Pages deployment at `https://example.github.io/qbsheet/`
therefore uses `https://example.github.io` as its CORS origin.

## Match Plan

**Format** defines the structure of the tournament — stages, pools, rounds, carryovers, and rebracketing.

**Match Plan** defines the games that will actually be played — the teams, round, room, and current status of each matchup.

Fruity can automatically assign rooms while still allowing tournament directors to keep specific games in specific rooms when necessary.

## Tournament Control

Control is the tournament-day workspace for seeing what needs attention.

It includes:

* room and device readiness
* active games
* submitted results
* help requests
* Match Plan assignments
* round release
* room reassignment
* Hold new starts
* public display controls

**Hold new starts** prevents rooms from beginning another game without interrupting games already in progress.

## Public pairings

Fruity can publish the currently released round on a read-only page for teams and spectators.

Players can search for their team and quickly see:

```text
Round 5
Room 204
Ninety Six A vs Greenwood
```

Future unreleased pairings are not published.

## Quick start

### Requirements

* Node.js
* npm

Clone the repository and install dependencies:

```sh
git clone https://github.com/Gibsonmb71/fruity.git
cd fruity
npm install
```

Start Fruity in development:

```sh
npm start
```

Build the application:

```sh
npm run build
```

Package the Electron app:

```sh
npm run package
```

For Windows packaging:

```sh
npm run package-win
```

## Development

Fruity is primarily built with:

* **Electron** — desktop application
* **React + TypeScript** — desktop, room, and public interfaces
* **MODAQ** — browser scorekeeping
* **Material UI** — desktop interface

The project builds four targets:

| Target | Purpose |
| --- | --- |
| **main** | Electron main process |
| **renderer** | Fruity desktop app |
| **room** | Browser room scoring |
| **live** | Public displays and pairings |

Before submitting changes:

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

## YellowFruit

Fruity is based on [YellowFruit](https://github.com/ANadig/YellowFruit) by Andrew Nadig.

## Contributing

Bug reports, testing, and contributions are welcome. (please do send them)

Please use [GitHub Issues](https://github.com/Gibsonmb71/fruity/issues) for bugs and feature requests.

If reporting an issue involving browser room scoring, do not post room access tokens or other tournament credentials publicly.

## License

Fruity is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
