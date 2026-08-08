/**
 * @vitest-environment jsdom
 */

/**
 * The scoring screen, driven the way a scorekeeper drives it.
 *
 * No screenshots and nothing about pixels — what is checked here is that the controls a format
 * implies actually appear, that one click on a player records a whole tossup, and that the screen
 * moves itself to the next thing without being told.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import scoringRulesToScorekeeperFormat, { IScorekeeperFormat } from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import AnswerType from '../renderer/DataModel/AnswerType';
import ScorerHost from '../room/scorer/ScorerHost';
import { RoomConnectionState } from '../room/RoomLifecycle';

const leftTeam = {
  name: 'Ninety Six',
  players: [{ name: 'Sarah Mitchell' }, { name: 'James Robinson' }],
};
const rightTeam = {
  name: 'Greenwood',
  players: [{ name: 'Emma Turner' }, { name: 'Jordan Lee' }],
};

function formatFor(mutate: (rules: ScoringRules) => void = () => {}): IScorekeeperFormat {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  rules.maximumPlayersPerTeam = 2;
  mutate(rules);
  return scoringRulesToScorekeeperFormat(rules);
}

let gameCounter = 0;

function renderScorer(
  format: IScorekeeperFormat,
  onSubmit?: ReturnType<typeof vi.fn>,
  onRequestControl?: (category: any, message: string) => Promise<void>,
) {
  const submit = onSubmit ?? vi.fn().mockResolvedValue({ ok: true, message: 'Sent' });
  gameCounter += 1;
  render(
    <ScorerHost
      gameKey={`test-game-${gameCounter}`}
      format={format}
      leftTeam={leftTeam}
      rightTeam={rightTeam}
      tournamentName="Ninety Six Invitational"
      roundName="4"
      roomName="Room 204"
      connection={RoomConnectionState.Connected}
      onSubmit={submit}
      onRequestControl={onRequestControl}
    />,
  );
  return { onSubmit: submit };
}

/**
 * The scoring buttons on one player's row.
 *
 * Matched against the roster specifically: a player's name also appears in the activity rail once
 * they have buzzed, and a bare text query would find both.
 */
function buttonsFor(playerName: string): HTMLElement[] {
  const row = Array.from(document.querySelectorAll('.scorer-player')).find(
    (candidate) => candidate.querySelector('.scorer-player-name')?.textContent === playerName,
  );
  if (!row) throw new Error(`No roster row for ${playerName}`);
  return within(row as HTMLElement).getAllByRole('button');
}

/**
 * Press a control wherever it currently lives.
 *
 * The footer and the Game menu trade controls between them as the layout settles, and a test that
 * hard-codes which one holds "Players" is asserting on a layout decision rather than on behaviour.
 * This looks on the footer first, then opens the menu.
 */
function pressControl(name: string | RegExp) {
  const onFooter = screen.queryByRole('button', { name });
  if (onFooter) {
    fireEvent.click(onFooter);
    return;
  }
  fireEvent.click(screen.getByText('Game'));
  fireEvent.click(screen.getByText(name));
}

/** Every control the screen offers, footer and Game menu together. */
function availableControls(): string[] {
  fireEvent.click(screen.getByText('Game'));
  return Array.from(document.querySelectorAll('.scorer-footer button, .scorer-menu-item')).map(
    (button) => button.textContent ?? '',
  );
}

function scoreOf(teamName: string): string {
  return screen.getByLabelText(`${teamName} score`).textContent ?? '';
}

/**
 * The jsdom this repo resolves does not provide localStorage, and the scorer saves through it.
 *
 * Shimmed rather than worked around, because the recovery test below is only meaningful if saving
 * actually happens. What the real storage does when it is full, corrupt or hostile is covered
 * properly in RoomGameSession.test.ts, which injects its own.
 */
function installLocalStorage() {
  let store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    },
  });
}

/** jsdom exposes `<dialog>` but not the modal methods browsers provide. */
function installDialogMethods() {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

beforeEach(() => {
  installLocalStorage();
  installDialogMethods();
});

afterEach(() => {
  cleanup();
});

describe('what the header says', () => {
  test('it names the tournament, round and room, and not the software', () => {
    renderScorer(formatFor());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ninety Six Invitational');
    expect(screen.getByText(/Round 4/).textContent).toContain('Room 204');
    expect(document.body.textContent).not.toMatch(/YellowFruit|MODAQ|Fruity/);
  });

  test('it shows the connection state and how far the game has got', () => {
    renderScorer(formatFor());

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Tossup 1 of 20')).toBeTruthy();
  });
});

describe('scoring buttons come from the format', () => {
  test('mACF gives each player +15 / +10 / -5', () => {
    renderScorer(formatFor());

    expect(buttonsFor('Sarah Mitchell').map((button) => button.textContent)).toEqual(['+15', '+10', '-5']);
  });

  test('a format with no powers gives two', () => {
    renderScorer(formatFor((rules) => rules.applyRuleSet(CommonRuleSets.Acf)));

    expect(buttonsFor('Sarah Mitchell').map((button) => button.textContent)).toEqual(['+10', '-5']);
  });

  test('a 7-point format with a -3 shows exactly that', () => {
    // MODAQ refuses this outright: its base tossup value is hardcoded at 10.
    renderScorer(
      formatFor((rules) => {
        rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];
      }),
    );

    expect(buttonsFor('Sarah Mitchell').map((button) => button.textContent)).toEqual(['+7', '-3']);
  });

  test('two power tiers and two negs all appear', () => {
    renderScorer(
      formatFor((rules) => {
        rules.answerTypes = [
          new AnswerType(20),
          new AnswerType(15),
          new AnswerType(10),
          new AnswerType(-5),
          new AnswerType(-10),
        ];
      }),
    );

    expect(buttonsFor('Sarah Mitchell').map((button) => button.textContent)).toEqual([
      '+20',
      '+15',
      '+10',
      '-5',
      '-10',
    ]);
  });

  test('only active players get a row, and no empty seats are drawn', () => {
    renderScorer(
      formatFor((rules) => {
        rules.maximumPlayersPerTeam = 1;
      }),
    );

    expect(screen.queryByText('James Robinson')).toBeNull();
    expect(screen.getByText('Sarah Mitchell')).toBeTruthy();
  });
});

describe('scoring a tossup', () => {
  test('one click records the buzz and the score moves', () => {
    renderScorer(formatFor());

    fireEvent.click(buttonsFor('Sarah Mitchell')[1]); // +10

    expect(scoreOf('Ninety Six')).toBe('10');
  });

  test('a conversion goes straight to the bonus, unasked', () => {
    renderScorer(formatFor());

    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);

    const prompt = screen.getByLabelText('Bonus');
    expect(within(prompt).getByText('Ninety Six')).toBeTruthy();
  });

  test('the bonus buttons are generated from the bonus structure', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);

    const choices = within(screen.getByLabelText('Bonus')).getAllByRole('button');

    expect(choices.map((button) => button.textContent)).toEqual(['0', '10', '20', '30']);
  });

  test('a four-part bonus offers a fifth button', () => {
    renderScorer(
      formatFor((rules) => {
        rules.minimumPartsPerBonus = 4;
        rules.maximumPartsPerBonus = 4;
        rules.pointsPerBonusPart = 10;
        rules.maximumBonusScore = 40;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);

    const choices = within(screen.getByLabelText('Bonus')).getAllByRole('button');

    expect(choices.map((button) => button.textContent)).toEqual(['0', '10', '20', '30', '40']);
  });

  test('recording the bonus scores it and returns to the next tossup', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);

    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('20'));

    expect(scoreOf('Ninety Six')).toBe('30');
    expect(screen.getByText('Tossup 2 of 20')).toBeTruthy();
  });

  test('an irregular bonus asks for a number instead of offering buttons', () => {
    renderScorer(
      formatFor((rules) => {
        rules.pointsPerBonusPart = undefined;
      }),
    );

    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);

    expect(screen.getByLabelText('Bonus points')).toBeTruthy();
  });
});

describe('a tossup that is not over yet', () => {
  test('a neg leaves the other team able to answer', () => {
    renderScorer(formatFor());

    fireEvent.click(buttonsFor('Sarah Mitchell')[2]); // -5

    expect(scoreOf('Ninety Six')).toBe('-5');
    expect(screen.getByText(/Greenwood may still answer/)).toBeTruthy();
    expect(screen.getByText('Tossup 1 of 20')).toBeTruthy();
  });

  test('the team that negged cannot buzz again on the same tossup', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[2]);

    expect(buttonsFor('Sarah Mitchell').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(buttonsFor('Emma Turner').every((button) => (button as HTMLButtonElement).disabled)).toBe(false);
  });

  test('the other team converting scores both teams', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[2]);

    fireEvent.click(buttonsFor('Emma Turner')[1]);

    expect(scoreOf('Ninety Six')).toBe('-5');
    expect(screen.getByLabelText('Bonus')).toBeTruthy();
  });
});

describe('no buzz', () => {
  test('it records an unanswered tossup and advances on its own', () => {
    renderScorer(formatFor());

    fireEvent.click(screen.getByRole('button', { name: 'No buzz' }));

    expect(screen.getByText('Tossup 2 of 20')).toBeTruthy();
    expect(screen.getByText('No buzz', { selector: '.scorer-rail-what' })).toBeTruthy();
  });
});

describe('undo', () => {
  test('it takes back the last thing recorded', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[0]); // +15

    fireEvent.click(screen.getByText('Undo'));

    expect(scoreOf('Ninety Six')).toBe('0');
    expect(screen.getByText('Tossup 1 of 20')).toBeTruthy();
  });

  test('it is unavailable before anything has happened', () => {
    renderScorer(formatFor());

    expect((screen.getByText('Undo') as HTMLButtonElement).disabled).toBe(true);
  });

  test('redo becomes available after undo and restores the action', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[0]);
    fireEvent.click(screen.getByText('Undo'));

    const redo = screen.getByText('Redo') as HTMLButtonElement;
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);

    expect(scoreOf('Ninety Six')).toBe('15');
  });

  test('Ctrl+Z in a scoring input is left to the input', () => {
    renderScorer(
      formatFor((rules) => {
        rules.pointsPerBonusPart = undefined;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    const input = screen.getByLabelText('Bonus points');

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });

    expect(scoreOf('Ninety Six')).toBe('10');
    expect(screen.getByLabelText('Bonus points')).toBeTruthy();
  });
});

describe('the recent rail', () => {
  test('it shows only what actually happened', () => {
    renderScorer(formatFor());

    expect(screen.getByText('Nothing scored yet.')).toBeTruthy();

    fireEvent.click(buttonsFor('Sarah Mitchell')[0]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('20'));

    const rail = screen.getByLabelText('Recent activity');
    // What happened and what it was worth are separate cells, so the points can be set in their own
    // right-aligned column. Assert on the pairing rather than on one run of text.
    const lines = Array.from(rail.querySelectorAll('.scorer-rail-line')).map((line) => [
      line.querySelector('.scorer-rail-what')?.textContent,
      line.querySelector('.scorer-rail-points')?.textContent,
    ]);

    expect(lines).toEqual([
      ['Sarah Mitchell', '+15'],
      ['Ninety Six bonus', '+20'],
    ]);
  });

  test('a dead tossup reads as one line with nothing in the points column', () => {
    renderScorer(formatFor());

    fireEvent.click(screen.getByRole('button', { name: 'No buzz' }));

    const rail = screen.getByLabelText('Recent activity');
    const line = rail.querySelector('.scorer-rail-line');

    expect(line?.querySelector('.scorer-rail-what')?.textContent).toBe('No buzz');
    expect(line?.querySelector('.scorer-rail-points')?.textContent).toBe('');
  });
});

describe('the game menu', () => {
  test('keeps operational tools behind the single Game menu', () => {
    renderScorer(formatFor());
    const controls = availableControls();

    // Matched loosely: what matters is that each tool is reachable from the scoring screen without
    // hunting, not which of the footer or the menu is holding it today.
    for (const tool of [/players/i, /issue/i, /scoresheet review/i, /download qbj/i, /recover from qbj/i]) {
      expect(
        controls.some((control) => tool.test(control)),
        `${tool} should be reachable`,
      ).toBe(true);
    }
  });

  test('lightning is offered only when the format has lightning rounds', () => {
    renderScorer(formatFor());
    fireEvent.click(screen.getByText('Game'));

    expect(screen.queryByText('Lightning / worksheet')).toBeNull();

    cleanup();
    renderScorer(
      formatFor((rules) => {
        rules.lightningCountPerTeam = 1;
      }),
    );
    fireEvent.click(screen.getByText('Game'));

    expect(screen.getByText('Lightning / worksheet')).toBeTruthy();
  });

  test('end regulation is offered only for a timed round', () => {
    renderScorer(formatFor());
    fireEvent.click(screen.getByText('Game'));

    expect(screen.queryByText('End regulation')).toBeNull();

    cleanup();
    renderScorer(
      formatFor((rules) => {
        rules.timed = true;
      }),
    );
    fireEvent.click(screen.getByText('Game'));

    expect(screen.getByText('End regulation')).toBeTruthy();
  });

  test('substitutions are reachable and change who is on the floor', () => {
    renderScorer(
      formatFor((rules) => {
        rules.maximumPlayersPerTeam = 1;
      }),
    );
    pressControl('Players');

    const lineup = screen.getByLabelText('Ninety Six lineup');
    fireEvent.click(within(lineup).getByLabelText(/Sarah Mitchell/));
    fireEvent.click(within(lineup).getByLabelText(/James Robinson/));
    fireEvent.click(within(lineup).getByText('Apply to Ninety Six'));

    expect(screen.queryByText('Sarah Mitchell')).toBeNull();
    expect(screen.getByText('James Robinson')).toBeTruthy();
  });

  test('a lineup change after tossup activity is shown as effective on the next tossup', () => {
    renderScorer(
      formatFor((rules) => {
        rules.maximumPlayersPerTeam = 1;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[2]); // neg starts Tossup 1
    pressControl('Players');

    expect(screen.getByText('Changes apply starting Tossup 2.')).toBeTruthy();
  });

  test('a player can be added during a game and the roster change is sent to control', async () => {
    const requestControl = vi.fn().mockResolvedValue(undefined);
    renderScorer(formatFor(), undefined, requestControl);
    pressControl('Players');

    fireEvent.change(screen.getByLabelText('Add player during game', { selector: '#scorer-add-player-left' }), {
      target: { value: 'Taylor Brooks' },
    });
    fireEvent.click(within(screen.getByLabelText('Ninety Six lineup')).getByText('Add to bench'));

    await vi.waitFor(() =>
      expect(requestControl).toHaveBeenCalledWith('roster-change', expect.stringContaining('Taylor Brooks')),
    );
  });

  test('reviewing the scoresheet can correct an earlier ruling', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]); // +10
    pressControl('Full scoresheet review');
    fireEvent.click(screen.getByText('Edit'));

    fireEvent.change(screen.getByLabelText('Ruling'), { target: { value: '0' } }); // +15
    fireEvent.click(screen.getByText('Save correction'));

    expect(scoreOf('Ninety Six')).toBe('15');
  });

  test('buzz correction uses the players who were active for that tossup', () => {
    renderScorer(
      formatFor((rules) => {
        rules.maximumPlayersPerTeam = 1;
      }),
    );
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    pressControl('Full scoresheet review');
    fireEvent.click(screen.getByText('Edit'));

    const player = screen.getByLabelText('Player') as HTMLSelectElement;
    expect(Array.from(player.options, (option) => option.value)).toEqual(['Sarah Mitchell']);
    expect(Array.from(player.options, (option) => option.value)).not.toContain('James Robinson');
  });

  test('an invalid bonus correction stays open with an explanation', () => {
    renderScorer(formatFor());
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('20'));
    pressControl('Full scoresheet review');
    fireEvent.click(screen.getAllByText('Edit')[1]);

    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Save correction'));

    expect(screen.getByText('The most a bonus can be worth is 30.')).toBeTruthy();
    expect(screen.getByText('Save correction')).toBeTruthy();
  });

  test('removing a scoresheet event requires confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderScorer(formatFor());
    fireEvent.click(screen.getByRole('button', { name: 'No buzz' }));
    pressControl('Full scoresheet review');

    fireEvent.click(screen.getByText('Remove'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No buzz', { selector: '.scorer-review-event > span' })).toBeTruthy();
    confirm.mockRestore();
  });

  test('a protest is saved and can request tournament control', async () => {
    const requestControl = vi.fn().mockResolvedValue(undefined);
    renderScorer(formatFor(), undefined, requestControl);
    pressControl(/issue/i);
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'The ruling was disputed.' } });
    fireEvent.click(screen.getByText('Save and request control'));

    await vi.waitFor(() => expect(requestControl).toHaveBeenCalledWith('protest', 'The ruling was disputed.'));
  });
});

describe('finishing', () => {
  /** Play out a full regulation, with one team ahead so it is not a tie. */
  const playRegulation = () => {
    fireEvent.click(buttonsFor('Sarah Mitchell')[1]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('20'));
    for (let question = 2; question <= 20; question += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'No buzz' }));
    }
  };

  test('the game ends itself and offers to submit', () => {
    renderScorer(formatFor());

    playRegulation();

    // "Game complete" appears in both the progress indicator and the panel, which is the point.
    expect(screen.getAllByText('Game complete').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Submit result' })).toBeTruthy();
  });

  test('submitting hands the result over exactly once', async () => {
    const { onSubmit } = renderScorer(formatFor());
    playRegulation();

    fireEvent.click(screen.getByText('Submit result'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // What it hands over is a QBJ match, not the scorer's own state.
    expect(onSubmit.mock.calls[0][0]).toHaveProperty('match_teams');
  });

  test('a tied regulation goes to overtime rather than ending', () => {
    renderScorer(formatFor());
    for (let question = 1; question <= 20; question += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'No buzz' }));
    }

    // Still tied, so the game has not ended: it has gone to overtime.
    expect(screen.getByText(/Overtime tossup 1/)).toBeTruthy();
  });

  test('a tied game is called out without offering submission', () => {
    renderScorer(formatFor());
    for (let question = 1; question <= 20; question += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'No buzz' }));
    }

    expect(screen.getByText('This game is a tie.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit result' })).toBeNull();
  });
});

describe('recovering a game', () => {
  test('a reload comes back to the same game rather than an empty one', () => {
    const format = formatFor();
    gameCounter += 1;
    const gameKey = `recovery-${gameCounter}`;
    const submit = vi.fn();
    // The same game, mounted twice, exactly as a reload would.
    const mount = () =>
      render(
        <ScorerHost
          gameKey={gameKey}
          format={format}
          leftTeam={leftTeam}
          rightTeam={rightTeam}
          tournamentName="Ninety Six Invitational"
          roundName="4"
          connection={RoomConnectionState.Connected}
          onSubmit={submit}
        />,
      );

    const first = mount();
    fireEvent.click(buttonsFor('Sarah Mitchell')[0]);
    fireEvent.click(within(screen.getByLabelText('Bonus')).getByText('30'));
    expect(scoreOf('Ninety Six')).toBe('45');
    first.unmount();

    mount();

    expect(scoreOf('Ninety Six')).toBe('45');
    expect(screen.getByText('Tossup 2 of 20')).toBeTruthy();
  });
});
