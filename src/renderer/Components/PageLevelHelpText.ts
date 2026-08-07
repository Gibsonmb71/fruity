import { ApplicationPages } from '../Enums';

export type HelpTextSection = {
  header?: string;
  content: string[];
};

/** Stable ids for page, subsection, and inline help. Components use ids instead of embedding copy. */
export type HelpTopicId =
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
  | 'general.game-entry'
  | 'control.server'
  | 'control.pairing'
  | 'control.match-inbox'
  | 'control.public-pairings';

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
  'general.game-entry': [
    {
      header: 'Game entry mode',
      content: [
        'Traditional entry keeps scoring inside YellowFruit. Browser room scoring lets paired room browsers submit finals to the Match Inbox for explicit review.',
      ],
    },
  ],
  'control.server': RoomsPageHelpText,
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
