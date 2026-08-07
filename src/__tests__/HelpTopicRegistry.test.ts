/**
 * Structural checks on the help system, not on its prose.
 *
 * Wording is going to change and should be free to; what must not change is that every `?` in the
 * application opens something, that the topics tournament directors most often ask about exist, and
 * that an inline `?` beside one control does not open the help for the whole page it happens to sit
 * on. The last one is the failure mode worth a test: it is invisible in review, because attaching
 * `setup.rules` to a single field type-checks perfectly.
 */
import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { getHelpText, HelpTopicId, helpRegistry } from '../renderer/Components/PageLevelHelpText';

/**
 * Topics that describe a whole page or subsection. These are what the Help action in the top header
 * opens, and they are the ones that must never be attached to an individual control.
 */
const pageTopics: HelpTopicId[] = [
  'setup',
  'setup.tournament',
  'setup.rules',
  'setup.teams',
  'setup.format',
  'games',
  'control',
  'control.live',
  'control.match-plan',
  'control.rooms',
  'control.display',
  'reports',
];

/** The settings a director is most likely to stop and wonder about. */
const requiredTargetedTopics: HelpTopicId[] = [
  'rules.timed',
  'rules.regulation-tossups',
  'rules.answer-values',
  'rules.bonus-divisor',
  'rules.bouncebacks',
  'rules.overtime',
  'rules.overtime-bonuses',
  'rules.maximum-players',
  'rules.lightning',
  'rules.lightning-divisor',
  'format.stage',
  'format.pool',
  'format.tiebreaker',
  'format.finals',
  'format.carryover',
  'format.rebracketing',
  'control.browser-scoring',
  'control.keep-room',
  'control.auto-assign',
  'control.rebalance',
  'control.release-round',
  'control.hold',
  'control.pairing-code',
  'control.reset-room-access',
  'control.network-interface',
  'control.live-display',
  'control.public-pairings',
  'control.room-inheritance',
  'games.tuh',
  'games.carryover',
  'games.forfeit',
  'games.ignored-warning',
  'games.overtime',
  'games.special-scoring',
  'reports.scope',
  'reports.include-carryover',
  'reports.readiness',
  'reports.sqbs-scope',
];

const rendererRoot = path.join(__dirname, '..', 'renderer');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

interface IHelpReference {
  file: string;
  topic: string;
  /** True when it came from a `helpTopic=` prop rather than a direct `<YfHelpPopover topic=`. */
  viaProp: boolean;
}

/** Every help topic the UI actually asks for, gathered from the source. */
function helpReferences(): IHelpReference[] {
  const references: IHelpReference[] = [];
  for (const file of sourceFiles(rendererRoot)) {
    if (file.endsWith('PageLevelHelpText.ts')) continue;
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(/helpTopic="([^"]+)"/g)) {
      references.push({ file, topic: match[1], viaProp: true });
    }
    for (const match of contents.matchAll(/<YfHelpPopover\s+topic="([^"]+)"/g)) {
      references.push({ file, topic: match[1], viaProp: false });
    }
  }
  return references;
}

describe('the registry is complete', () => {
  test('every topic in the union has help text', () => {
    const empty = (Object.keys(helpRegistry) as HelpTopicId[]).filter((topic) => getHelpText(topic).length === 0);

    expect(empty).toEqual([]);
  });

  test('every section has at least one paragraph', () => {
    const emptySections = (Object.keys(helpRegistry) as HelpTopicId[]).filter((topic) =>
      getHelpText(topic).some(
        (section) => section.content.length === 0 || section.content.some((p) => p.trim() === ''),
      ),
    );

    expect(emptySections).toEqual([]);
  });

  test('the settings directors ask about all have targeted topics', () => {
    const missing = requiredTargetedTopics.filter((topic) => getHelpText(topic).length === 0);

    expect(missing).toEqual([]);
  });

  test('a targeted topic stays short enough to read in a popover', () => {
    // Not a wording test: a limit on length, so anything essay-sized gets pushed into page help.
    const tooLong = requiredTargetedTopics.filter(
      (topic) =>
        getHelpText(topic)
          .flatMap((section) => section.content)
          .join(' ').length > 500,
    );

    expect(tooLong).toEqual([]);
  });

  test('room allocation inheritance is explained, including the levels with no control of their own', () => {
    const text = getHelpText('control.room-inheritance')
      .flatMap((section) => [section.header ?? '', ...section.content])
      .join(' ')
      .toLowerCase();

    for (const concept of ['enabled', 'stage', 'round', 'pool', 'match plan']) {
      expect(text).toContain(concept);
    }
  });
});

/**
 * A few facts the help is not allowed to get wrong.
 *
 * Deliberately not prose tests: wording stays free to change, and reviewing the copy against the
 * code is still the real check. These pin only the claims that were actually wrong once, where the
 * mistake reads as perfectly plausible quiz-bowl English and so would survive review again.
 */
describe('claims the help must not make', () => {
  function textOf(topic: HelpTopicId): string {
    return getHelpText(topic)
      .flatMap((section) => [section.header ?? '', ...section.content])
      .join(' ')
      .toLowerCase();
  }

  test('overtime toss-ups are part of toss-ups read, and the help says so rather than the opposite', () => {
    // Match.tossupsRead is the whole game including overtime; overtimeTossupsRead says how many of
    // those were overtime. Claiming an exclusion from TUH would contradict both the model and NAQT.
    const text = textOf('games.overtime');

    expect(text).not.toMatch(
      /(excluded|not counted|do not count|don’t count|separate from).{0,40}(tuh|toss-ups (read|heard))/,
    );
    expect(text).toMatch(/toss-ups read|toss-ups heard/);
  });

  test('regulation toss-ups is not described as the divisor for every statistic', () => {
    // It is a normalization length and a validation baseline. Per-toss-up statistics divide by the
    // toss-ups actually heard.
    const text = textOf('rules.regulation-tossups');

    expect(text).not.toMatch(/divisor (behind|for) every/);
  });

  test('the public display is not described as showing scores in progress', () => {
    // buildPublicLiveSnapshot publishes standings, individuals, accepted results and the released
    // round. Live in-progress scores go to the Control page and nowhere else.
    const text = textOf('control.live-display');

    // Matched as an affirmative offer, so the copy stays free to say what it does *not* publish.
    expect(text).not.toMatch(/(watch|follow|see|view)[^.]{0,40}(scores in progress|live scores)/);
    expect(text).toContain('accepted results');
  });
});

describe('what the UI asks for', () => {
  test('the scan actually finds the help in the source, so the checks below mean something', () => {
    expect(helpReferences().length).toBeGreaterThan(20);
  });

  test('every referenced topic exists and has content', () => {
    const broken = helpReferences().filter((reference) => getHelpText(reference.topic as HelpTopicId).length === 0);

    expect(broken.map((reference) => `${path.basename(reference.file)}: ${reference.topic}`)).toEqual([]);
  });

  test('no control opens the help for the whole page it sits on', () => {
    const broad = helpReferences().filter((reference) => pageTopics.includes(reference.topic as HelpTopicId));

    expect(broad.map((reference) => `${path.basename(reference.file)}: ${reference.topic}`)).toEqual([]);
  });

  test('page titles do not duplicate the contextual Help already in the header', () => {
    const titlesWithHelp = sourceFiles(rendererRoot).filter((file) =>
      /<YfPageHeader[^>]*helpTopic=/s.test(readFileSync(file, 'utf8')),
    );

    expect(titlesWithHelp.map((file) => path.basename(file))).toEqual([]);
  });
});
