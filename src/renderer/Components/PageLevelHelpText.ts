import { ApplicationPages } from '../Enums';

export type HelpTextSection = {
  header?: string;
  content: string[];
};

/**
 * Stable ids for page, subsection, and inline help. Components use ids instead of embedding copy.
 *
 * Two kinds of topic live here and they are not interchangeable:
 *
 * - Page and subsection topics (`setup.rules`, `control.match-plan`) are what the Help action in the
 *   top header opens. They describe a whole area of the application.
 * - Field topics (`rules.bonus-divisor`, `control.keep-room`) are what an inline `?` next to one
 *   control opens. They describe that control and nothing else.
 *
 * Attaching a page topic to a single field is the mistake worth naming: the reader clicked a
 * question mark beside one setting and got an essay about the page they were already looking at.
 */
export type HelpTopicId =
  // Page and subsection topics, reached from the Help action in the header.
  | 'setup'
  | 'setup.tournament'
  | 'setup.rules'
  | 'setup.teams'
  | 'setup.format'
  | 'games'
  | 'control'
  | 'control.live'
  | 'control.match-plan'
  | 'control.rooms'
  | 'control.display'
  | 'reports'
  | 'control.server'
  | 'control.pairing'
  | 'control.match-inbox'
  | 'control.public-pairings'
  // Scoring rules, one topic per setting.
  | 'rules.timed'
  | 'rules.regulation-tossups'
  | 'rules.answer-values'
  | 'rules.bonus-divisor'
  | 'rules.bouncebacks'
  | 'rules.overtime'
  | 'rules.overtime-bonuses'
  | 'rules.maximum-players'
  | 'rules.lightning'
  | 'rules.lightning-divisor'
  // Format structure.
  | 'format.stage'
  | 'format.pool'
  | 'format.tiebreaker'
  | 'format.finals'
  | 'format.carryover'
  | 'format.rebracketing'
  // Tournament-day control.
  | 'control.browser-scoring'
  | 'control.keep-room'
  | 'control.auto-assign'
  | 'control.rebalance'
  | 'control.release-round'
  | 'control.hold'
  | 'control.pairing-code'
  | 'control.reset-room-access'
  | 'control.network-interface'
  | 'control.live-display'
  | 'control.room-inheritance'
  // Game entry.
  | 'games.tuh'
  | 'games.carryover'
  | 'games.forfeit'
  | 'games.ignored-warning'
  | 'games.overtime'
  | 'games.special-scoring'
  // Reports and export.
  | 'reports.scope'
  | 'reports.include-carryover'
  | 'reports.readiness'
  | 'reports.sqbs-scope';

const GeneralPageHelpText: HelpTextSection[] = [
  {
    header: 'General tournament attributes',
    content: [
      'The tournament name, location, dates, and question set fields are optional and appear at the top of the Standings page of the stat report if provided.',
    ],
  },
  {
    header: 'Packet names',
    content: [
      "Once you configure the tournament format in the Format form, you can specify the packet for each round here. Packet names are optional and are shown in their corresponding rounds on the Team Detail and Round Report pages of the stat report if provided. They are most helpful for packet submission tournaments or other situations where the order of packets isn't obvious.",
    ],
  },
  {
    header: 'Team and player attributes',
    content: ['Use these settings to determine which attributes appear in the stat report.'],
  },
];

const RulesPageHelpText: HelpTextSection[] = [
  {
    content: [
      "To ensure the integrity of game data, settings in this form can't be changed once you've begun entering games.",
    ],
  },
  {
    header: 'Divisors',
    content: [
      "A divisor is the greatest integer guaranteed to evenly divide a certain point total. Divisors are used to validate the correctness of bonus and lightning round totals. You should only change these settings if your tournament's questions have unusual or irregular bonus or lightning round formats. Divisor errors won't prevent you from saving games and can be overridden if needed.",
    ],
  },
];

const SchedulePageHelpText: HelpTextSection[] = [
  {
    content: [
      'Use this form to define the structure of your tournament. A tournament consists of one or more stages (sometimes called "phases"), each of which spans one or more rounds of play.',
      "You must define a format in order to enter game results. Games can't be entered for rounds that aren't defined in the format.",
    ],
  },
  {
    header: 'Templates',
    content: [
      'YellowFruit has pre-configured templates for most common tournament formats. When you use a template, YellowFruit is aware of the structure of the tournament and can use the stats for a given stage to determine which teams should qualify for which pools in the subsequent stage (this determination can be overridden if needed).',
    ],
  },
  {
    header: 'Custom formats',
    content: [
      'You can define your own format by customizing a template or adding new stages from scratch. If the button at the top right of the form is disabled and reads "custom", you are using a custom format, and you will need to assign teams to playoff pools manually during rebracketing.',
      "When using a custom format, use the Add Playoff Stage button to add additional stages of pool-based (e.g. round-robin or card system) play. You don't need to use a custom format to add tiebreaker or finals stages.",
    ],
  },
  {
    header: 'Tiers',
    content: [
      'In many format templates, playoff stages are divided into "tiers", which represent a cohort of teams that are competing for the same final rank. For example, tier 1 might contain the top 8 teams competing for first place, tier 2 the next 8 teams competing for 9th place, etc.',
    ],
  },
  {
    header: 'Tiebreaker stages',
    content: [
      'Each standard stage may have one tiebreaker stage immediately after it. Tiebreaker stages cannot contain pools; they are for recording the results of games needed to break ties in the previous stage.',
    ],
  },
  {
    header: 'Finals stages',
    content: [
      'You can add any number of Finals stages at the end of the format. Finals stages are intended for any additional placement games that happen after playoff or superplayoff pool play has finished. Examples include overall finals, small school finals, or third place games.',
    ],
  },
];

const TeamsPageHelpText: HelpTextSection[] = [
  {
    header: 'Registration',
    content: [
      "Use this page to define teams and rosters. The sum of the pool sizes in the first stage of the tournament's format determines the maximum number of teams you can create.",
    ],
  },
  {
    header: 'Prelim Assignments',
    content: [
      'Use this page to assign teams to pools for the first stage of the tournament. If you are using a format template, you can rank teams and let YellowFruit snake seed them into the appropriate pools.',
    ],
  },
  {
    header: 'Rebracketing / Final Ranks',
    content: [
      "Use this page to review tournament standings and bracket teams into the appropriate playoff pools. If you're using a format template, YellowFruit suggests the most likely pool assignments, which you can either confirm or override.",
      "In the standings for the last stage of the tournament, you can override the final ranking of each team if needed. This is useful in situations involving finals or parallel-bracket placement games, where the ordering of teams in playoff pool play doesn't necessarily reflect the overall final rankings.",
      'Once you\'ve confirmed that the final rankings are correct, check the "Final rankings ready to publish" checkbox to show the final rankings at the top of the Standings page of the stat report.',
    ],
  },
];

const GamesPageHelpText: HelpTextSection[] = [
  {
    content: [
      "The By Pool page allows you to track the progress of round robin pools. Pools that run multiple round robins have multiple grids. Pools that aren't round robin can't be viewed on this page. How many round robins a pool runs is defined in the Format form.",
    ],
  },
];

const RoomsPageHelpText: HelpTextSection[] = [
  {
    header: 'Tournament Server',
    content: [
      'Starting the tournament server lets other devices on the same network open a scorekeeping page served by this computer, so scorekeepers can enter games in a browser instead of exporting a file and importing it here by hand.',
      "The server is off until you start it, only runs while YellowFruit is open, and is only reachable from your local network. Use one of the addresses shown to open the scorekeeping page on the scorekeeper's device.",
      "Some scoring rules can't be used for room scorekeeping, because the browser scorekeeping interface can't represent them. If that's the case, the reasons are listed and the server won't let rooms start games.",
    ],
  },
  {
    header: 'Active Games',
    content: [
      'Each room uploads its game every few seconds so you can follow along. These live scores are for monitoring only and never affect standings.',
      "A room shown as disconnected hasn't reported in for a while. The scorekeeper can keep scoring regardless: their game is saved in their browser and will be submitted once the network comes back.",
    ],
  },
  {
    header: 'Match Inbox',
    content: [
      'When a room finishes a game, it appears here with the same validation YellowFruit applies to a QBJ file you import by hand. Games are never accepted automatically.',
      'Accepting a game adds it to its round exactly as importing a file would, so standings and the stat report update normally. Rejecting it tells the room, and they can fix the problem and submit again.',
    ],
  },
];

const StatReportPageHelpText: HelpTextSection[] = [
  {
    content: [
      'The export button saves all six stat report pages at once, appending "_standings", "_individuals", etc. to the file name you provide.',
    ],
  },
];

const ControlMatchPlanHelpText: HelpTextSection[] = [
  {
    header: 'Match Plan',
    content: [
      'The Match Plan is the authoritative list of games the tournament intends to play. Assignments reach rooms only after the round is released by tournament control.',
      'Accepted history is retained. Rebalancing changes future assignments only and never moves a game that is already playing, submitted, or accepted.',
    ],
  },
];

const ControlRoomsHelpText: HelpTextSection[] = [
  {
    header: 'Rooms',
    content: [
      'A room is a durable physical location with a human pairing code and a separate long access credential. Pair new browsers at /join; the access credential is never printed as text.',
      'Connected and Ready are operational signals from the room browsers. They do not alter the schedule or a score already in progress.',
    ],
  },
  ...RoomsPageHelpText,
];

const ControlDisplayHelpText: HelpTextSection[] = [
  {
    header: 'Public display and pairings',
    content: [
      'The audience and display URLs are read-only. Public pairings are a separate setting and page, so publishing the room schedule does not turn on the rotating standings display.',
      'Public pairings include only the director-released/current round and contain no room credentials, sessions, or operational controls.',
    ],
  },
];

const TournamentServerHelpText: HelpTextSection[] = RoomsPageHelpText.slice(0, 1);

/**
 * One short answer per setting: what it means, when you'd change it, what changes as a result.
 *
 * These are read while someone is mid-decision with a dialog open, so they are three sentences at
 * most. Anything that needs more room belongs in the page-level Help the header opens.
 */
const fieldHelp: Record<TargetedHelpTopicId, HelpTextSection> = {
  'rules.timed': {
    header: 'Timed rounds',
    content: [
      'The round ends on the clock, so a game can finish before every regulation toss-up has been read.',
      'Turn this on for a tournament run to a timer. A game with fewer toss-ups heard than the regulation count is then ordinary rather than something to review, and browser room scoring uses it to work out how many questions were actually played.',
    ],
  },
  'rules.regulation-tossups': {
    header: 'Toss-ups in regulation',
    content: [
      'How long a full game is: the number of toss-ups a game is expected to reach.',
      'It is the baseline game entry checks a game against, and the game length that rates like points per game are scaled to. It is not the divisor for per-toss-up statistics — those use the toss-ups actually heard. Change it only to match the question set being played.',
    ],
  },
  'rules.answer-values': {
    header: 'Toss-up point values',
    content: [
      'Every point value a toss-up buzz can be worth, including negatives.',
      'The rule set you picked already sets these. Add or remove a value only for a set that scores differently — an unusual power tier, or no negatives. Game entry offers exactly these values, and browser room scoring refuses to run on values it cannot represent.',
    ],
  },
  'rules.bonus-divisor': {
    header: 'Bonus divisor',
    content: [
      'Used to validate bonus totals. Leave this at the rule set default unless the packet uses unusual bonus scoring.',
      'A total that is not a multiple of the divisor is reported as a warning; it never blocks saving a game.',
    ],
  },
  'rules.bouncebacks': {
    header: 'Bouncebacks',
    content: [
      'Bonus parts the controlling team misses are offered to the other team.',
      'Turn this on only if the format really plays that way. It adds a bounceback points field to every team in game entry, and bounceback points are counted separately from ordinary bonus points throughout the stat report.',
    ],
  },
  'rules.overtime': {
    header: 'Overtime',
    content: [
      'The smallest number of toss-ups an overtime period runs to. Sudden death means one, so overtime can end as soon as a toss-up is converted.',
      'It is what game entry checks a recorded overtime against, and what tells a room browser how early overtime may end. It is a minimum, not a cap: it does not limit how long an overtime may run.',
    ],
  },
  'rules.overtime-bonuses': {
    header: 'Bonuses in overtime',
    content: [
      'Whether a toss-up converted in overtime is followed by a bonus.',
      'Most formats do not play them. With this off, overtime conversions are not counted as bonuses heard, and points per game and per-toss-up rates are computed from regulation alone. With it on, overtime counts in all of them.',
    ],
  },
  'rules.maximum-players': {
    header: 'Maximum active players',
    content: [
      'How many players from one team are at the table at once.',
      'It sets the toss-ups heard each team is expected to add up to — this many players times the toss-ups read — and a team adding up to more than that is an error. Raise it only for a format that genuinely seats more than four.',
    ],
  },
  'rules.lightning': {
    header: 'Lightning rounds',
    content: [
      'A separate scored round played alongside the toss-up/bonus cycle, used by a few formats.',
      'Turning it on adds a lightning points field for each team in game entry and a lightning column to the stat report. Browser room scoring cannot score lightning rounds, so rooms are unavailable while it is on.',
    ],
  },
  'rules.lightning-divisor': {
    header: 'Lightning divisor',
    content: [
      'Used to validate lightning round totals, the same way the bonus divisor validates bonuses.',
      'Change it only if the lightning round is scored in units other than the rule set default. A total that does not divide evenly is a warning, not an error.',
    ],
  },
  'format.stage': {
    header: 'Stages',
    content: [
      'A stage is one block of the tournament — prelims, playoffs, finals — spanning a consecutive range of rounds.',
      'Rounds must belong to a stage before games can be entered in them, and statistics are computed per stage. A stage’s round range cannot be narrowed past a round that already has games, because that would move those games between statistical groupings.',
    ],
  },
  'format.pool': {
    header: 'Pools',
    content: [
      'A pool is a group of teams that play each other inside one stage.',
      'Its size and number of round robins decide which pairings the stage expects, which is what schedule generation produces, what the Match Plan is checked for completeness against, and what the By Pool grids track.',
    ],
  },
  'format.tiebreaker': {
    header: 'Tiebreaker stage',
    content: [
      'A short stage attached to the stage before it, for games played only to break a tie in those standings.',
      'A tiebreaker stage has no pools; converting an existing stage into one deletes its pools. Use it so tiebreaker games are recorded without distorting the pool play they resolve.',
    ],
  },
  'format.finals': {
    header: 'Finals stage',
    content: [
      'A stage for placement games played after pool play has finished — an overall final, a third-place game, a small-school final.',
      'Finals stages have no pools; converting an existing stage into one deletes its pools. Their games count in the stat report but do not affect playoff pool standings.',
    ],
  },
  'format.carryover': {
    header: 'Carryover',
    content: [
      'Results from the previous stage are carried into this pool, so two teams who already played each other do not play again.',
      'Available only for a single round robin. It changes how many games the pool expects and which earlier games appear in this stage’s standings.',
    ],
  },
  'format.rebracketing': {
    header: 'Rebracketing',
    content: [
      'Placing each team into the next stage’s pools based on how they finished this one.',
      'With a format template YellowFruit suggests the placement and you confirm it; with a custom format you assign every team by hand. Nothing is moved until you confirm, and confirming a stage is what lets its next round be released to rooms.',
    ],
  },
  'control.browser-scoring': {
    header: 'Browser room scoring',
    content: [
      'Off, results are entered or imported here in Games — the traditional YellowFruit workflow, and still the default.',
      'On, paired room browsers submit finished games to the Match Inbox, where you accept or reject each one. Nothing is ever added to the tournament automatically. Turning it off again is refused while a room still has a game in progress or a result awaiting review.',
    ],
  },
  'control.keep-room': {
    header: 'Keep room',
    content: [
      'Protects a room you chose deliberately from being moved by Auto-assign or Rebalance.',
      'Use it when a game has to be in a specific room — a room with a buzzer set that works, a room near the building entrance. Everything else stays free for the allocator to move.',
    ],
  },
  'control.auto-assign': {
    header: 'Auto-assign unassigned',
    content: [
      'Fills in a room for every future game that has none, and touches nothing else.',
      'Rooms already chosen — by you or by an earlier run — are left exactly as they are. You see the full list of proposed changes before anything is applied.',
    ],
  },
  'control.rebalance': {
    header: 'Rebalance upcoming',
    content: [
      'Recomputes room assignments across the upcoming rounds, which can move games that already had a room.',
      'Games that are playing, submitted, accepted, or marked Keep room are never moved. Use it after adding, disabling, or reordering rooms. You preview every change before applying it.',
    ],
  },
  'control.release-round': {
    header: 'Releasing a round',
    content: [
      'Rooms cannot start a round until you release it. Releasing is what makes the next matchup appear on the room browsers.',
      'A round can be released once every game in it has an enabled, eligible room, the previous round is complete, nothing in it needs attention, and any rebracketing before it has been confirmed. Releasing does not start a game; a scorekeeper still presses Start.',
    ],
  },
  'control.hold': {
    header: 'Hold new room starts',
    content: [
      'Stops rooms starting a new game. Games already in progress are not interrupted and can still be submitted.',
      'The tournament-day pause: use it for a protest, a packet problem, or a schedule change you are still making. Rooms see your hold message. To stop a game that is already being scored, ask the room directly — Hold will not.',
    ],
  },
  'control.pairing-code': {
    header: 'Pairing code',
    content: [
      'The 8-digit code someone types at /join to pair a browser with this room. It is short because it gets read off a printed sheet.',
      'It is not the room’s credential: exchanging it once gives that browser a long access token, stored in the browser and never shown as text. Issuing a new code only stops the old code being used to pair — browsers already paired to this room keep working.',
    ],
  },
  'control.reset-room-access': {
    header: 'Reset room access',
    content: [
      'Invalidates the long access token every browser paired to this room is holding.',
      'Use it when a device has left the building or was paired by mistake. Every browser for this room has to pair again with the code; a game already in progress in this room cannot continue and should be finished first.',
    ],
  },
  'control.network-interface': {
    header: 'Network address',
    content: [
      'Which of this computer’s network addresses the room devices should open.',
      'A laptop on Wi-Fi with a VPN or a virtual adapter has several, and only the one on the same network as the room devices works. Use Test connection to confirm the one you picked before printing it on room sheets.',
    ],
  },
  'control.live-display': {
    header: 'Live display',
    content: [
      'A read-only page anyone on the network can open, showing standings, individual statistics, recently accepted results, and the released round’s pairings.',
      'It publishes accepted results only — not live scores from games in progress, which stay on the Control page. It is separate from public pairings: turning one on does not turn on the other, and neither exposes room credentials or controls.',
    ],
  },
  'control.room-inheritance': {
    header: 'How a game ends up in a room',
    content: [
      'A room is eligible for a game only if it passes every one of these at once — they narrow each other, none overrides the rest:',
      'Enabled rooms; the stage’s room set; a round override; a pool’s locked room restriction; and the rounds a room is available for. The Match Plan then holds the one room chosen from what is left, and a room that stops being eligible is reported rather than used.',
    ],
  },
  'games.tuh': {
    header: 'Toss-ups read',
    content: [
      'How many toss-ups were actually heard in this game, including any played in overtime.',
      'It must agree with the per-player toss-ups heard, and with the regulation count unless the rules allow a game to end early. A disagreement is what most game-entry warnings are about.',
    ],
  },
  'games.carryover': {
    header: 'Carryover',
    content: [
      'Also count this game in the standings of the stages listed, not only the one it was played in.',
      'Set automatically on the earlier game when two teams are bracketed into a pool that carries results over. Change it by hand only for a game that genuinely counts in more than one stage.',
    ],
  },
  'games.forfeit': {
    header: 'Forfeit',
    content: [
      'This team loses without the game being played; the other team wins.',
      'A forfeit records a win and a loss and nothing else: no toss-ups, no player statistics, no bonus or lightning scoring. It still counts in the win-loss record. Marking both teams instead records the game as not played, counting for neither.',
    ],
  },
  'games.ignored-warning': {
    header: 'Ignored warnings',
    content: [
      'Dismisses a warning for this game only, so the game can be saved without changing the number that caused it.',
      'For the case where the unusual number is genuinely correct. Errors can never be ignored. Restore brings the warning back if you want to look again.',
    ],
  },
  'games.overtime': {
    header: 'Overtime',
    content: [
      'How many of this game’s toss-ups were played past regulation. They are already part of Toss-ups read, and of every player’s toss-ups heard; this says how many of them were overtime.',
      'You only need it when the game was tied at the end of regulation. Unless the rules play bonuses in overtime, those toss-ups are left out of bonuses heard and of the rates computed per regulation-length game.',
    ],
  },
  'games.special-scoring': {
    header: 'Bonus, bounceback and lightning',
    content: [
      'The scoring that is not toss-up buzzes: bonus points, bounceback points, and lightning round points.',
      'Which of these appear depends on the scoring rules, and totals are checked against the relevant divisor. They are not entered for a forfeit.',
    ],
  },
  'reports.scope': {
    header: 'Report scope',
    content: [
      'Which stages the statistics on this page are computed from.',
      'Use it to publish prelim standings separately from playoff standings, or to look at one stage on its own. It changes what you are looking at and what an HTML export contains; it never changes any recorded game.',
    ],
  },
  'reports.include-carryover': {
    header: 'Include carried-over games',
    content: [
      'Also count games carried into the selected stages from an earlier stage.',
      'Include them for standings that reflect a team’s full record going into the playoffs; leave them out to see only what was played inside the selected stages.',
    ],
  },
  'reports.readiness': {
    header: 'Publication readiness',
    content: [
      'What YellowFruit can and cannot verify about the data behind this report.',
      'Each check reads verified, a problem, or unknown — unknown meaning it cannot be established here, as game completeness cannot be without a Match Plan. It never stops you exporting. It tells you what a reader would find wrong, and what nobody has checked.',
    ],
  },
  'reports.sqbs-scope': {
    header: 'Stages to export',
    content: [
      'Which stages go into the SQBS file, and whether they are combined into one file or split into one file per stage.',
      'SQBS represents one bracket at a time, so a multi-stage tournament usually exports as separate files. This affects the exported file only.',
    ],
  },
};

/** Every topic that describes one control rather than a whole page. */
export type TargetedHelpTopicId = Exclude<
  HelpTopicId,
  | 'setup'
  | 'setup.tournament'
  | 'setup.rules'
  | 'setup.teams'
  | 'setup.format'
  | 'games'
  | 'control'
  | 'control.live'
  | 'control.match-plan'
  | 'control.rooms'
  | 'control.display'
  | 'reports'
  | 'control.server'
  | 'control.pairing'
  | 'control.match-inbox'
  | 'control.public-pairings'
>;

/** The centralized registry used by both the page dialog and compact inline help. */
export const helpRegistry: Record<HelpTopicId, HelpTextSection[]> = {
  setup: [...GeneralPageHelpText, ...RulesPageHelpText, ...SchedulePageHelpText, ...TeamsPageHelpText],
  'setup.tournament': GeneralPageHelpText,
  'setup.rules': RulesPageHelpText,
  'setup.teams': TeamsPageHelpText,
  'setup.format': SchedulePageHelpText,
  games: GamesPageHelpText,
  control: RoomsPageHelpText,
  'control.live': RoomsPageHelpText,
  'control.match-plan': ControlMatchPlanHelpText,
  'control.rooms': ControlRoomsHelpText,
  'control.display': ControlDisplayHelpText,
  reports: StatReportPageHelpText,
  // Scoped to the Tournament Server section rather than repeating the whole Control page, so the
  // inline `?` beside that heading answers a narrower question than the header's Help does.
  'control.server': TournamentServerHelpText,
  'control.pairing': ControlRoomsHelpText,
  'control.match-inbox': [
    {
      header: 'Match Inbox',
      content: [
        'Review and accept a submitted final only after checking its validation and score. Rejection returns the room to a correct-and-resubmit state without creating a duplicate game.',
      ],
    },
  ],
  'control.public-pairings': ControlDisplayHelpText,
  ...(Object.fromEntries(Object.entries(fieldHelp).map(([topic, section]) => [topic, [section]])) as Record<
    TargetedHelpTopicId,
    HelpTextSection[]
  >),
};

export function getHelpText(topic: HelpTopicId): HelpTextSection[] {
  return helpRegistry[topic] ?? [];
}

export function getContextualAppPageHelpText(page: ApplicationPages, topic?: HelpTopicId): HelpTextSection[] {
  if (topic && helpRegistry[topic]) return getHelpText(topic);
  switch (page) {
    case ApplicationPages.Setup:
      return getHelpText('setup');
    case ApplicationPages.Games:
      return getHelpText('games');
    case ApplicationPages.Control:
      return getHelpText('control.live');
    case ApplicationPages.Reports:
      return getHelpText('reports');
    default:
      return [];
  }
}

export default function getAppPageHelpText(page: ApplicationPages) {
  return getContextualAppPageHelpText(page);
}
