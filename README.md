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
