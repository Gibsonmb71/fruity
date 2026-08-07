# Fruity 🍌

A modern, tournament-day focused fork of [YellowFruit](https://github.com/ANadig/YellowFruit).

Fruity keeps YellowFruit's statkeeping, `.yft`, QBJ, SQBS, and reporting tools while adding scheduling, room management, browser scoring, and live tournament operations.

## What's different?

- **Match Plan** - schedule matchups and assign rooms
- **Browser scoring** - score from Chromebooks and other devices using MODAQ
- **Easy room setup** - pair devices with a QR code or 8-digit room code
- **Tournament Control** - see rooms, active games, submitted results, and issues in one place
- **Result review** - accept or reject room submissions before they become official
- **Public pairings** - publish the currently released round for teams
- **Live Display** - standings, results, individual stats, and pairings
- **Room operations** - readiness, help requests, room holds, reassignment, and more

## Development

```bash
git clone https://github.com/Gibsonmb71/fruity.git
cd fruity
npm install
npm start
