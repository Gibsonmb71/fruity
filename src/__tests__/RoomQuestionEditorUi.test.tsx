/**
 * @vitest-environment jsdom
 */

/**
 * Correcting one question, from the Recent activity rail.
 *
 * The correction engine is not what is under test — `RoomQuestionCorrection.test.ts` covers the
 * atomic replace and the revalidation. What is under test is that the screen over it asks the three
 * questions a scorekeeper is actually answering (which team, which player, what was the ruling) and
 * that every option in it comes from the configured format rather than from a rule set somebody
 * assumed. A correction dialog with a hard-coded +10 is a correction dialog that silently rescores
 * a 7-point tournament.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import scoringRulesToScorekeeperFormat, { IScorekeeperFormat } from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import AnswerType from '../renderer/DataModel/AnswerType';
import ScorerHost from '../room/scorer/ScorerHost';
import { RoomConnectionState } from '../room/RoomLifecycle';
import { installDialogMethods, installLocalStorage } from './RoomScorerTestHarness';

const leftTeam = { name: 'Ninety Six', players: [{ name: 'Sarah Mitchell' }, { name: 'James Robinson' }] };
const rightTeam = { name: 'Greenwood', players: [{ name: 'Emma Turner' }, { name: 'Jordan Lee' }] };

function formatFor(mutate: (rules: ScoringRules) => void = () => {}): IScorekeeperFormat {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  rules.maximumPlayersPerTeam = 2;
  mutate(rules);
  return scoringRulesToScorekeeperFormat(rules);
}

let gameCounter = 0;

function renderScorer(format: IScorekeeperFormat) {
  gameCounter += 1;
  render(
    <ScorerHost
      gameKey={`question-editor-${gameCounter}`}
      format={format}
      leftTeam={leftTeam}
      rightTeam={rightTeam}
      tournamentName="Ninety Six Invitational"
      roundName="Round 4"
      connection={RoomConnectionState.Connected}
      onSubmit={vi.fn().mockResolvedValue({ ok: true, message: 'Sent' })}
    />,
  );
}

function buttonsFor(player: string) {
  return screen.getAllByRole('button').filter((button) => button.getAttribute('aria-label')?.startsWith(player));
}

function scoreOf(team: string): string {
  return screen.getByLabelText(`${team} score`).textContent ?? '';
}

/** Open the editor for the question the Recent rail is showing. */
function openEditor() {
  fireEvent.click(screen.getByText('Game'));
  fireEvent.click(screen.getByText('Full scoresheet review'));
  fireEvent.click(screen.getByText('Edit question'));
}

beforeEach(() => {
  installLocalStorage();
  installDialogMethods();
});

afterEach(() => {
  cleanup();
});

describe('what the editor leads with', () => {
  test('the question, and what it did to the score', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[0]); // +15
    fireEvent.click(screen.getByText('20'));
    openEditor();

    expect(screen.getByText('Question 1')).toBeTruthy();
    expect(screen.getByText('Score before')).toBeTruthy();
    expect(screen.getByText('Score after')).toBeTruthy();
    expect(screen.getByText('Ninety Six 0 · Greenwood 0')).toBeTruthy();
    expect(screen.getByText('Ninety Six 35 · Greenwood 0')).toBeTruthy();
  });

  test('the lineup and the technical explanation wait behind More', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    openEditor();

    expect(screen.queryByText(/On the floor/)).toBeNull();
    fireEvent.click(screen.getByText('More…'));
    expect(screen.getByText(/On the floor/)).toBeTruthy();
  });
});

describe('the ruling is one control', () => {
  test('it offers exactly the format’s answer values plus the wrong answer that costs nothing', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]); // +10
    openEditor();

    const ruling = screen.getByLabelText('Ruling') as HTMLSelectElement;
    expect(Array.from(ruling.options, (option) => option.textContent)).toEqual(['+15', '+10', '-5', 'Wrong · 0']);
  });

  test('a custom rule set produces custom rulings, with nothing assumed', () => {
    renderScorer(
      formatFor((rules) => {
        rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[0]); // +7
    openEditor();

    const ruling = screen.getByLabelText('Ruling') as HTMLSelectElement;
    expect(Array.from(ruling.options, (option) => option.textContent)).toEqual(['+7', '-3', 'Wrong · 0']);
  });

  test('choosing a different value rescores the question and everything after it', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]); // +10
    fireEvent.click(screen.getByText('20'));
    expect(scoreOf('Ninety Six')).toBe('30');

    openEditor();
    const ruling = screen.getByLabelText('Ruling') as HTMLSelectElement;
    const power = Array.from(ruling.options).find((option) => option.textContent === '+15');
    fireEvent.change(ruling, { target: { value: power?.value } });
    fireEvent.click(screen.getByText('Save correction'));

    expect(scoreOf('Ninety Six')).toBe('35');
  });

  test('the same control turns a buzz into a wrong answer worth nothing', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[2]); // -5
    openEditor();

    const ruling = screen.getByLabelText('Ruling') as HTMLSelectElement;
    const wrong = Array.from(ruling.options).find((option) => option.textContent === 'Wrong · 0');
    fireEvent.change(ruling, { target: { value: wrong?.value } });
    fireEvent.click(screen.getByText('Save correction'));

    // The neg is gone, and nothing replaced it in the score.
    expect(scoreOf('Ninety Six')).toBe('0');
  });
});

describe('two attempts', () => {
  test('two attempts can be swapped and saved with their values and scores intact', () => {
    renderScorer(formatFor());
    fireEvent.click(screen.getByLabelText('Sarah Mitchell 0 after readout wrong, no penalty'));
    fireEvent.click(buttonsFor('Emma Turner')[1]); // +10 for Greenwood
    fireEvent.click(screen.getByText('30'));
    expect(scoreOf('Ninety Six')).toBe('0');
    expect(scoreOf('Greenwood')).toBe('40');

    openEditor();
    const teamOf = (attempt: number) =>
      (screen.getByLabelText(`Question 1 attempt ${attempt} team`) as HTMLSelectElement).value;
    const rulingOf = (attempt: number) => {
      const select = screen.getByLabelText(`Question 1 attempt ${attempt} ruling`) as HTMLSelectElement;
      return select.selectedOptions[0]?.textContent;
    };
    expect([teamOf(1), teamOf(2)]).toEqual(['left', 'right']);
    expect([rulingOf(1), rulingOf(2)]).toEqual(['Wrong · 0', '+10']);
    // One control for order, rather than an Up and a Down on every row of a two-row list.
    expect(screen.getByText('Swap order')).toBeTruthy();
    expect(screen.queryByText('Up')).toBeNull();
    expect(screen.queryByText('Down')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Swap order' }));
    expect([teamOf(1), teamOf(2)]).toEqual(['right', 'left']);
    expect([rulingOf(1), rulingOf(2)]).toEqual(['+10', 'Wrong · 0']);
    fireEvent.click(screen.getByText('Save correction'));

    expect(scoreOf('Ninety Six')).toBe('0');
    expect(scoreOf('Greenwood')).toBe('40');
  });
});

describe('the bonus', () => {
  test('a question that earned no bonus does not open a bonus form', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[2]); // a neg: no conversion, no bonus
    openEditor();

    expect(screen.queryByRole('group', { name: 'Bonus points' })).toBeNull();
    expect(screen.getByText('Add bonus')).toBeTruthy();
  });

  test('the quick totals are generated from the configured bonus structure', () => {
    renderScorer(
      formatFor((rules) => {
        rules.maximumBonusScore = 20;
        rules.pointsPerBonusPart = 5;
        rules.bonusDivisor = 5;
        rules.minimumPartsPerBonus = 4;
        rules.maximumPartsPerBonus = 4;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('10'));
    openEditor();

    const totals = within(screen.getByRole('group', { name: 'Bonus points' })).getAllByRole('button');
    expect(totals.map((button) => button.textContent)).toEqual(['0', '5', '10', '15', '20']);
  });

  test('bouncebacks are absent when the format has none', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.click(screen.getByText('20'));
    openEditor();
    expect(screen.queryByLabelText('Bonus bounceback points')).toBeNull();
  });

  test('bouncebacks appear when the format has them', () => {
    renderScorer(
      formatFor((rules) => {
        rules.bonusesBounceBack = true;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('20'));
    // With bouncebacks the scorer asks the opponent's share before the cycle is finished.
    fireEvent.click(within(screen.getByLabelText('Bounceback')).getByText('10'));
    openEditor();
    expect(screen.getByLabelText('Bonus bounceback points')).toBeTruthy();
  });

  test('enumerable bonus parts recalculate the total while hiding total-only controls', () => {
    renderScorer(
      formatFor((rules) => {
        rules.maximumBonusScore = 20;
        rules.pointsPerBonusPart = 5;
        rules.bonusDivisor = 5;
        rules.minimumPartsPerBonus = 4;
        rules.maximumPartsPerBonus = 4;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('10'));
    openEditor();

    fireEvent.click(screen.getByText('Enter parts…'));
    const points = screen.getByLabelText('Points') as HTMLInputElement;
    expect(points.disabled).toBe(true);
    expect(screen.queryByRole('group', { name: 'Bonus points' })).toBeNull();
    expect(screen.queryByLabelText('Bonus bounceback points')).toBeNull();

    fireEvent.change(screen.getByLabelText('Bonus part 1 controlled points'), { target: { value: '5' } });
    expect(points.value).toBe('5');
  });

  test('an irregular bonus asks for a number, because its parts are not enumerable', () => {
    renderScorer(
      formatFor((rules) => {
        rules.minimumPartsPerBonus = 1;
        rules.maximumPartsPerBonus = 5;
        rules.pointsPerBonusPart = 0;
        rules.bonusDivisor = 5;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.change(screen.getByLabelText(/Bonus points/), { target: { value: '25' } });
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('Record'));
    openEditor();

    expect(screen.queryByRole('group', { name: 'Bonus points' })).toBeNull();
    expect(screen.getByLabelText('Points')).toBeTruthy();
  });

  test('a correction that creates a conversion can add the bonus it earns', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[2]); // -5
    fireEvent.click(buttonsFor('Emma Turner')[1]); // Greenwood converts
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('0'));

    openEditor();

    // The bonus control is present and attributed to the team that converted.
    expect(screen.getByRole('group', { name: 'Bonus points' })).toBeTruthy();
    expect(screen.getByText(/Bonus — GREENWOOD/)).toBeTruthy();
  });
});
