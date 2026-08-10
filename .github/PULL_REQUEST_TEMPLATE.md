<!--
Thanks for contributing. CONTRIBUTING.md has the details:
https://github.com/gbyo/fruity/blob/master/CONTRIBUTING.md

Delete any section below that does not apply.
-->

## What this changes

<!-- What behavior is different after this PR, and why. Link the issue it closes: "Closes #123". -->

## How it was tested

<!--
Automated coverage: which test files, and for a bug fix, the test that fails without the change.
Manual verification: what you actually exercised by hand.
-->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test -- --run`
- [ ] `npm run build`
- [ ] New behavior has a test; a bug fix has a test that fails without the change

## Targets touched

<!-- Which of the four webpack targets this affects. -->

- [ ] `main` — Electron main process, file I/O, tournament server
- [ ] `renderer` — desktop app
- [ ] `room` — browser room client and scorer
- [ ] `live` — public pairings and Live Display
- [ ] `shared` — types crossing those boundaries

## Tournament-day risk

<!--
Required if this touches rooms, the tournament server, recovery, or file formats.
What could break for a director who is mid-tournament on an older build, or has files from one?
Write "None" if there is genuinely no exposure.
-->

- [ ] Existing `.yft`, QBJ, and SQBS files still open correctly
- [ ] The desktop app is still the authority — no room submission becomes official without acceptance
- [ ] Recovery still holds: server restart or room disconnection mid-game does not lose a result

## Protocol and format changes

<!-- Delete this whole section if the wire surface and file formats are untouched. -->

- [ ] `/qbtcp/v1` and the deprecated `/api/v1` aliases still resolve to the same handlers
- [ ] Exported assignments still carry no room credentials, server URL, or other room's game
- [ ] The matching spec change is open in [`gbyo/qbsheet`](https://github.com/gbyo/qbsheet) and linked here
- [ ] A `qbsheet` dependency SHA bump is in its own commit, with a note on what changed there

## Screenshots

<!-- For UI changes. Before and after, if you can. -->
