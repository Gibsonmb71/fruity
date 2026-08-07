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
