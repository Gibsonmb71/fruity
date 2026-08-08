import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  IPublicIndividualStanding,
  IPublicLiveSnapshot,
  IPublicNextRoundAssignment,
  IPublicPairingsSnapshot,
  IPublicPhaseStanding,
  IPublicRecentResult,
  IPublicTeamStanding,
  LiveDisplayMode,
} from '../shared/LiveTypes';

type ConnectionState = 'loading' | 'connected' | 'reconnecting' | 'disabled';
type AudienceView = 'standings' | 'individuals' | 'pools' | 'results' | 'next-round';

const pollIntervalMs = 4000;
const validModes: LiveDisplayMode[] = ['standings', 'individuals', 'pools', 'results', 'next-round'];

function pairingsEmptyMessage(hasRound: boolean, hasQuery: boolean): string {
  if (!hasRound) return 'Tournament control has not released a round yet.';
  return hasQuery ? 'No released game found for this team.' : 'No room pairings are currently published.';
}

interface DisplaySlide {
  kind: LiveDisplayMode;
  title: string;
  eyebrow: string;
  page: number;
  pageCount: number;
  teams?: IPublicTeamStanding[];
  individuals?: IPublicIndividualStanding[];
  pool?: IPublicPhaseStanding['pools'][number];
  results?: IPublicRecentResult[];
  assignments?: IPublicNextRoundAssignment[];
  roundName?: string;
}

function usePublicSnapshot() {
  const [snapshot, setSnapshot] = useState<IPublicLiveSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('loading');
  const requestInFlight = useRef(false);

  useEffect(() => {
    let stopped = false;

    const refresh = async () => {
      if (stopped || requestInFlight.current) return;
      requestInFlight.current = true;
      try {
        const response = await fetch('/api/v1/public/snapshot', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 404) {
          if (!stopped) {
            // A director can turn the public view off while somebody is looking at it. Do not
            // leave the last private/public snapshot on screen after that explicit refusal.
            setSnapshot(null);
            setConnection('disabled');
          }
          return;
        }
        if (!response.ok) throw new Error(`Live snapshot request failed: ${response.status}`);
        const next = (await response.json()) as IPublicLiveSnapshot;
        if (!stopped) {
          setSnapshot(next);
          setConnection('connected');
        }
      } catch (_error) {
        if (!stopped) setConnection('reconnecting');
      } finally {
        requestInFlight.current = false;
      }
    };

    refresh();
    const interval = window.setInterval(refresh, pollIntervalMs);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, []);

  return { snapshot, connection };
}

export default function LiveApp() {
  if (window.location.pathname === '/live/pairings' || window.location.pathname === '/live/pairings/') {
    return <PublicPairingsApp />;
  }
  return <PublicLiveApp />;
}

function PublicLiveApp() {
  const { snapshot, connection } = usePublicSnapshot();
  const isDisplay = window.location.pathname === '/live/display' || window.location.pathname === '/live/display/';

  if (isDisplay) return <DisplayApp snapshot={snapshot} connection={connection} />;
  return <AudienceApp snapshot={snapshot} connection={connection} />;
}

function usePublicPairingsSnapshot() {
  const [snapshot, setSnapshot] = useState<IPublicPairingsSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('loading');
  const requestInFlight = useRef(false);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (stopped || requestInFlight.current) return;
      requestInFlight.current = true;
      try {
        const response = await fetch('/api/v1/public/pairings', { cache: 'no-store' });
        if (response.status === 404) {
          if (!stopped) {
            setSnapshot(null);
            setConnection('disabled');
          }
          return;
        }
        if (!response.ok) throw new Error(`Public pairings request failed: ${response.status}`);
        const next = (await response.json()) as IPublicPairingsSnapshot;
        if (!stopped) {
          setSnapshot(next);
          setConnection('connected');
        }
      } catch {
        if (!stopped) setConnection('reconnecting');
      } finally {
        requestInFlight.current = false;
      }
    };
    refresh();
    const interval = window.setInterval(refresh, pollIntervalMs);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, []);

  return { snapshot, connection };
}

function PublicPairingsApp() {
  const { snapshot, connection } = usePublicPairingsSnapshot();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const assignments =
    snapshot?.assignments.filter(
      (assignment) =>
        normalizedQuery === '' ||
        assignment.leftTeam.toLocaleLowerCase().includes(normalizedQuery) ||
        assignment.rightTeam.toLocaleLowerCase().includes(normalizedQuery),
    ) ?? [];
  return (
    <div className="live-site" data-theme="system">
      <header className="live-site-header">
        <div className="live-brand-mark" aria-hidden="true">
          YF
        </div>
        <div className="live-header-copy">
          <p className="live-kicker">Public pairings</p>
          <h1>{snapshot?.tournamentName ?? 'YellowFruit Pairings'}</h1>
        </div>
        <ConnectionStatus state={connection} />
      </header>
      <main className="live-audience-main live-pairings-main">
        {!snapshot ? (
          <ConnectionPanel connection={connection} />
        ) : (
          <section className="live-section" aria-labelledby="public-pairings-title">
            <div className="live-section-heading">
              <p className="live-kicker">Released room assignments</p>
              <h2 id="public-pairings-title">
                {snapshot.round ? `Round ${snapshot.round.number} · ${snapshot.round.name}` : 'Pairings not released'}
              </h2>
            </div>
            <div className="live-pairings-search">
              <span>Find a team</span>
              <input
                id="public-pairings-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Team name"
                aria-label="Find a team"
              />
            </div>
            <p className="live-pairings-count" aria-live="polite">
              {assignments.length} {assignments.length === 1 ? 'pairing' : 'pairings'}
              {normalizedQuery ? ` matching “${query.trim()}”` : ''}
            </p>
            {assignments.length === 0 ? (
              <EmptyMessage message={pairingsEmptyMessage(Boolean(snapshot.round), normalizedQuery !== '')} />
            ) : (
              <div className="live-table-wrap">
                <table className="live-table live-results-table">
                  <thead>
                    <tr>
                      <th scope="col">Room</th>
                      <th scope="col" className="live-name-cell">
                        Match
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <tr key={`${assignment.roomName}-${assignment.leftTeam}-${assignment.rightTeam}`}>
                        <th scope="row">{assignment.roomName}</th>
                        <td className="live-name-cell">
                          {assignment.leftTeam} <span className="live-vs">vs</span> {assignment.rightTeam}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
      <footer className="live-site-footer">Pairings update when tournament control releases the current round.</footer>
    </div>
  );
}

function AudienceApp({ snapshot, connection }: { snapshot: IPublicLiveSnapshot | null; connection: ConnectionState }) {
  const [activeView, setActiveView] = useState<AudienceView>('standings');
  const theme = snapshot?.settings.theme ?? 'system';
  return (
    <div className="live-site" data-theme={theme}>
      <SiteHeader snapshot={snapshot} connection={connection} />
      {snapshot ? (
        <>
          <nav className="live-audience-nav" aria-label="Live tournament views">
            {(
              [
                ['standings', 'Team standings'],
                ['individuals', 'Individuals'],
                ['pools', 'Pools / stages'],
                ['results', 'Recent results'],
                ['next-round', 'Next round'],
              ] as [AudienceView, string][]
            ).map(([view, label]) => (
              <button
                className={activeView === view ? 'is-active' : ''}
                key={view}
                type="button"
                aria-pressed={activeView === view}
                onClick={() => setActiveView(view)}
              >
                {label}
              </button>
            ))}
          </nav>
          <main className="live-audience-main">
            <AudienceViewContent snapshot={snapshot} view={activeView} />
          </main>
        </>
      ) : (
        <ConnectionPanel connection={connection} />
      )}
      <SiteFooter snapshot={snapshot} connection={connection} />
    </div>
  );
}

function SiteHeader({ snapshot, connection }: { snapshot: IPublicLiveSnapshot | null; connection: ConnectionState }) {
  return (
    <header className="live-site-header">
      <div className="live-brand-mark" aria-hidden="true">
        YF
      </div>
      <div className="live-header-copy">
        <p className="live-kicker">Live tournament</p>
        <h1>{snapshot?.tournamentName ?? 'YellowFruit Live'}</h1>
      </div>
      <div className="live-header-meta">
        {snapshot?.latestCompletedRound ? (
          <span>
            Latest completed <strong>{snapshot.latestCompletedRound.name}</strong>
          </span>
        ) : (
          <span>Waiting for the first completed game</span>
        )}
        <ConnectionStatus state={connection} />
      </div>
    </header>
  );
}

function AudienceViewContent({ snapshot, view }: { snapshot: IPublicLiveSnapshot; view: AudienceView }) {
  switch (view) {
    case 'individuals':
      return <IndividualsSection snapshot={snapshot} />;
    case 'pools':
      return <PoolsSection snapshot={snapshot} />;
    case 'results':
      return <ResultsSection results={snapshot.recentResults} />;
    case 'next-round':
      return <NextRoundSection nextRound={snapshot.nextRound} />;
    case 'standings':
    default:
      return <TeamStandingsSection snapshot={snapshot} />;
  }
}

function TeamStandingsSection({ snapshot }: { snapshot: IPublicLiveSnapshot }) {
  return (
    <section className="live-section" aria-labelledby="team-standings-title">
      <SectionHeading id="team-standings-title" eyebrow="Aggregate standings" title="Teams" />
      <TeamTable rows={snapshot.teamStandings} metricLabels={snapshot.metricLabels} compact={false} />
    </section>
  );
}

function IndividualsSection({ snapshot }: { snapshot: IPublicLiveSnapshot }) {
  return (
    <section className="live-section" aria-labelledby="individuals-title">
      <SectionHeading id="individuals-title" eyebrow="Individual statistics" title="Players" />
      {snapshot.individualStandings.length === 0 ? (
        <EmptyMessage message="Individual statistics will appear after an accepted game with player data." />
      ) : (
        <IndividualTable rows={snapshot.individualStandings} metricLabel={snapshot.metricLabels.individualPptuh} />
      )}
    </section>
  );
}

function PoolsSection({ snapshot }: { snapshot: IPublicLiveSnapshot }) {
  return (
    <section className="live-section" aria-labelledby="pools-title">
      <SectionHeading id="pools-title" eyebrow="Phase and pool standings" title="Stages" />
      {snapshot.phaseStandings.length === 0 ? (
        <EmptyMessage message="Pool standings will appear when tournament stages are configured." />
      ) : (
        <div className="live-pool-grid">
          {snapshot.phaseStandings.flatMap((phase) =>
            phase.pools.map((pool) => (
              <div className="live-pool-block" key={`${phase.phaseCode}-${pool.poolName}`}>
                <div className="live-pool-heading">
                  <span>{phase.phaseName}</span>
                  <strong>{pool.poolName}</strong>
                </div>
                <TeamTable rows={pool.teams} metricLabels={snapshot.metricLabels} compact />
              </div>
            )),
          )}
        </div>
      )}
    </section>
  );
}

function ResultsSection({ results }: { results: IPublicRecentResult[] }) {
  return (
    <section className="live-section" aria-labelledby="results-title">
      <SectionHeading id="results-title" eyebrow="Accepted results" title="Recent games" />
      {results.length === 0 ? <EmptyMessage message="No accepted results yet." /> : <ResultsTable results={results} />}
    </section>
  );
}

function NextRoundSection({ nextRound }: { nextRound: IPublicLiveSnapshot['nextRound'] }) {
  return (
    <section className="live-section" aria-labelledby="next-round-title">
      <SectionHeading
        id="next-round-title"
        eyebrow={nextRound ? `Assignments · ${nextRound.round.name}` : 'Assignments'}
        title={nextRound ? `Round ${nextRound.round.number}` : 'Next round'}
      />
      {!nextRound ? (
        <EmptyMessage message="The next round has not been released yet." />
      ) : (
        <AssignmentsTable assignments={nextRound.assignments} />
      )}
    </section>
  );
}

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div className="live-section-heading">
      <p className="live-kicker">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
    </div>
  );
}

function TeamTable({
  rows,
  metricLabels,
  compact,
}: {
  rows: IPublicTeamStanding[];
  metricLabels: IPublicLiveSnapshot['metricLabels'];
  compact: boolean;
}) {
  return (
    <div className={`live-table-wrap${compact ? ' is-compact' : ''}`}>
      <table className="live-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col" className="live-name-cell">
              Team
            </th>
            <th scope="col">Record</th>
            <th scope="col">Pct</th>
            <th scope="col">{metricLabels.teamPpg}</th>
            {metricLabels.teamPpb && <th scope="col">{metricLabels.teamPpb}</th>}
            <th scope="col">TUH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.teamName}-${row.rank}`}>
              <td className="live-rank-cell">{row.rank || '—'}</td>
              <th scope="row" className="live-name-cell">
                {row.teamName}
              </th>
              <td>{row.record}</td>
              <td>{formatPct(row.winPct)}</td>
              <td>{formatNumber(row.ppg, 1)}</td>
              {metricLabels.teamPpb && <td>{formatNumber(row.ppb, 2)}</td>}
              <td>{row.tossupsHeard || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyMessage message="No team standings yet." />}
    </div>
  );
}

function IndividualTable({ rows, metricLabel }: { rows: IPublicIndividualStanding[]; metricLabel: string }) {
  return (
    <div className="live-table-wrap">
      <table className="live-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col" className="live-name-cell">
              Player
            </th>
            <th scope="col" className="live-name-cell">
              Team
            </th>
            <th scope="col">GP</th>
            <th scope="col">TUH</th>
            <th scope="col">{metricLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.playerName}-${row.teamName}`}>
              <td className="live-rank-cell">{row.rank || '—'}</td>
              <th scope="row" className="live-name-cell">
                {row.playerName}
              </th>
              <td className="live-name-cell">{row.teamName}</td>
              <td>{row.gamesPlayed.toFixed(1)}</td>
              <td>{row.tossupsHeard}</td>
              <td>{formatNumber(row.pptuh, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTable({ results }: { results: IPublicRecentResult[] }) {
  return (
    <div className="live-table-wrap">
      <table className="live-table live-results-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col" className="live-name-cell">
              Match
            </th>
            <th scope="col">Score</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr
              key={`${result.roundNumber}-${result.leftTeam}-${result.rightTeam}-${result.leftScore ?? 'na'}-${
                result.rightScore ?? 'na'
              }`}
            >
              <td>{result.roundName}</td>
              <th scope="row" className="live-name-cell">
                {result.leftTeam} <span className="live-vs">vs</span> {result.rightTeam}
              </th>
              <td>{formatScore(result)}</td>
              <td>{resultLabel(result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignmentsTable({ assignments }: { assignments: IPublicNextRoundAssignment[] }) {
  return (
    <div className="live-table-wrap">
      <table className="live-table live-assignments-table">
        <thead>
          <tr>
            <th scope="col" className="live-name-cell">
              Match
            </th>
            <th scope="col">Room</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr key={`${assignment.leftTeam}-${assignment.rightTeam}-${assignment.roomName}`}>
              <th scope="row" className="live-name-cell">
                {assignment.leftTeam} <span className="live-vs">vs</span> {assignment.rightTeam}
              </th>
              <td>{assignment.roomName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DisplayApp({ snapshot, connection }: { snapshot: IPublicLiveSnapshot | null; connection: ConnectionState }) {
  const displayRoute = useMemo(() => parseDisplayRoute(window.location.search), []);
  const { fixedMode } = displayRoute;
  const theme = snapshot?.settings.theme ?? 'system';
  const slides = useMemo(() => (snapshot ? makeSlides(snapshot, fixedMode) : []), [snapshot, fixedMode]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [playing, setPlaying] = useState(displayRoute.autoRotate);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setCurrentSlide((current) => (slides.length === 0 ? 0 : Math.min(current, slides.length - 1)));
  }, [slides.length]);

  useEffect(() => {
    if (!playing || slides.length < 2) return undefined;
    const seconds = snapshot?.settings.slideDurationSeconds ?? 10;
    const handle = window.setInterval(() => {
      setCurrentSlide((current) => (current + 1) % slides.length);
    }, seconds * 1000);
    return () => window.clearInterval(handle);
  }, [playing, slides.length, snapshot?.settings.slideDurationSeconds]);

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const activeSlide = slides[currentSlide];
  let emptyMessage: string | undefined;
  if (snapshot && slides.length === 0) {
    emptyMessage = fixedMode
      ? 'This display view has no published data yet.'
      : 'No display slides are enabled. Ask tournament control to enable at least one slide.';
  }
  return (
    <div className="display-shell" data-theme={theme}>
      {activeSlide ? (
        <DisplaySlideView snapshot={snapshot as IPublicLiveSnapshot} slide={activeSlide} />
      ) : (
        <DisplayEmpty snapshot={snapshot} connection={connection} message={emptyMessage} />
      )}
      {snapshot && connection !== 'connected' && (
        <div className="display-connection-badge">
          {connection === 'reconnecting' ? 'Reconnecting · showing last update' : 'Live Display unavailable'}
        </div>
      )}
      {snapshot && (
        <>
          <div className="display-controls" aria-label="Display controls">
            <button
              type="button"
              onClick={() => setPlaying((value) => !value)}
              aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlide((current) => (current - 1 + slides.length) % slides.length)}
              disabled={slides.length < 2}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlide((current) => (current + 1) % slides.length)}
              disabled={slides.length < 2}
            >
              Next
            </button>
            <button type="button" onClick={() => toggleFullscreen()}>
              {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </div>
          {slides.length > 1 && (
            <div className="display-progress" style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }} />
          )}
        </>
      )}
    </div>
  );
}

function DisplaySlideView({ snapshot, slide }: { snapshot: IPublicLiveSnapshot; slide: DisplaySlide }) {
  return (
    <main className="display-content">
      <header className="display-header">
        <div>
          <p className="display-kicker">{slide.eyebrow}</p>
          <h1>{slide.title}</h1>
        </div>
        <div className="display-header-right">
          <span>{snapshot.tournamentName}</span>
          {snapshot.settings.showLastUpdated && <span>Updated {formatTime(snapshot.lastUpdatedAt)}</span>}
        </div>
      </header>
      <div className="display-stage">
        {slide.kind === 'standings' && <DisplayTeams rows={slide.teams ?? []} metricLabels={snapshot.metricLabels} />}
        {slide.kind === 'individuals' && (
          <DisplayIndividuals rows={slide.individuals ?? []} metricLabel={snapshot.metricLabels.individualPptuh} />
        )}
        {slide.kind === 'pools' && slide.pool && <DisplayPool pool={slide.pool} metricLabels={snapshot.metricLabels} />}
        {slide.kind === 'results' && <DisplayResults results={slide.results ?? []} />}
        {slide.kind === 'next-round' && <DisplayAssignments assignments={slide.assignments ?? []} />}
      </div>
      <footer className="display-footer">
        <span>{slide.pageCount > 1 ? `${slide.page} / ${slide.pageCount}` : ''}</span>
        <span>YellowFruit</span>
      </footer>
    </main>
  );
}

function DisplayTeams({
  rows,
  metricLabels,
}: {
  rows: IPublicTeamStanding[];
  metricLabels: IPublicLiveSnapshot['metricLabels'];
}) {
  return (
    <div className="display-table-wrap">
      <table className="display-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th className="display-wide-cell">Team</th>
            <th>Record</th>
            <th>Pct</th>
            <th>{metricLabels.teamPpg}</th>
            {metricLabels.teamPpb && <th>{metricLabels.teamPpb}</th>}
            <th>TUH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.teamName}-${row.rank}`}>
              <td>{row.rank || '—'}</td>
              <th className="display-wide-cell">{row.teamName}</th>
              <td>{row.record}</td>
              <td>{formatPct(row.winPct)}</td>
              <td>{formatNumber(row.ppg, 1)}</td>
              {metricLabels.teamPpb && <td>{formatNumber(row.ppb, 2)}</td>}
              <td>{row.tossupsHeard || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DisplayIndividuals({ rows, metricLabel }: { rows: IPublicIndividualStanding[]; metricLabel: string }) {
  return (
    <div className="display-table-wrap">
      {rows.length === 0 ? (
        <DisplayMessage message="Individual statistics are not available yet." />
      ) : (
        <table className="display-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th className="display-wide-cell">Player</th>
              <th className="display-wide-cell">Team</th>
              <th>GP</th>
              <th>TUH</th>
              <th>{metricLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.playerName}-${row.teamName}`}>
                <td>{row.rank || '—'}</td>
                <th className="display-wide-cell">{row.playerName}</th>
                <td className="display-wide-cell">{row.teamName}</td>
                <td>{row.gamesPlayed.toFixed(1)}</td>
                <td>{row.tossupsHeard}</td>
                <td>{formatNumber(row.pptuh, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DisplayPool({
  pool,
  metricLabels,
}: {
  pool: IPublicPhaseStanding['pools'][number];
  metricLabels: IPublicLiveSnapshot['metricLabels'];
}) {
  return (
    <div className="display-pool">
      <p className="display-pool-label">{pool.poolName}</p>
      <DisplayTeams rows={pool.teams} metricLabels={metricLabels} />
    </div>
  );
}

function DisplayResults({ results }: { results: IPublicRecentResult[] }) {
  if (results.length === 0) return <DisplayMessage message="No accepted results yet." />;
  return (
    <div className="display-results-list">
      {results.map((result) => (
        <div
          className="display-result-row"
          key={`${result.roundNumber}-${result.leftTeam}-${result.rightTeam}-${result.leftScore ?? 'na'}-${
            result.rightScore ?? 'na'
          }`}
        >
          <span className="display-result-round">{result.roundName}</span>
          <strong>{result.leftTeam}</strong>
          <span className="display-result-score">{formatScore(result)}</span>
          <strong>{result.rightTeam}</strong>
          <span className="display-result-label">{resultLabel(result)}</span>
        </div>
      ))}
    </div>
  );
}

function DisplayAssignments({ assignments }: { assignments: IPublicNextRoundAssignment[] }) {
  if (assignments.length === 0) return <DisplayMessage message="No released room assignments." />;
  return (
    <div className="display-assignment-list">
      {assignments.map((assignment) => (
        <div
          className="display-assignment-row"
          key={`${assignment.leftTeam}-${assignment.rightTeam}-${assignment.roomName}`}
        >
          <span>
            {assignment.leftTeam} <em>vs</em> {assignment.rightTeam}
          </span>
          <strong>{assignment.roomName}</strong>
        </div>
      ))}
    </div>
  );
}

function DisplayEmpty({
  snapshot,
  connection,
  message,
}: {
  snapshot: IPublicLiveSnapshot | null;
  connection: ConnectionState;
  message: string | undefined;
}) {
  return (
    <main className="display-empty">
      <div className="display-empty-mark">YF</div>
      <p className="display-kicker">YellowFruit Live</p>
      <h1>{snapshot?.tournamentName ?? 'Live tournament display'}</h1>
      {message ? (
        <div className="live-connection-panel">
          <strong>{message}</strong>
          <span>The live display is connected and will update when a view becomes available.</span>
        </div>
      ) : (
        <ConnectionPanel connection={connection} />
      )}
    </main>
  );
}

function ConnectionPanel({ connection }: { connection: ConnectionState }) {
  if (connection === 'disabled')
    return (
      <div className="live-connection-panel">
        <strong>Live Display is disabled</strong>
        <span>The tournament director has not published a public live view.</span>
      </div>
    );
  if (connection === 'reconnecting')
    return (
      <div className="live-connection-panel is-reconnecting">
        <strong>Reconnecting</strong>
        <span>Trying the tournament server again. The display will update automatically.</span>
      </div>
    );
  return (
    <div className="live-connection-panel">
      <strong>{connection === 'loading' ? 'Connecting' : 'Waiting for tournament data'}</strong>
      <span>No tournament snapshot is available yet.</span>
    </div>
  );
}

function SiteFooter({ snapshot, connection }: { snapshot: IPublicLiveSnapshot | null; connection: ConnectionState }) {
  return (
    <footer className="live-site-footer">
      {snapshot?.settings.showLastUpdated && <span>Last updated {formatTime(snapshot.lastUpdatedAt)}</span>}
      <ConnectionStatus state={connection} />
    </footer>
  );
}

function ConnectionStatus({ state }: { state: ConnectionState }) {
  let label = 'Connecting';
  if (state === 'connected') label = 'Live';
  else if (state === 'disabled') label = 'Unavailable';
  else if (state === 'reconnecting') label = 'Reconnecting';
  return (
    <span className={`live-status live-status-${state}`} role="status" aria-live="polite">
      <span className="live-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return <div className="live-empty-message">{message}</div>;
}

function DisplayMessage({ message }: { message: string }) {
  return <div className="display-message">{message}</div>;
}

export function parseDisplayRoute(search: string): {
  fixedMode: LiveDisplayMode | null;
  explicitRotate: boolean;
  autoRotate: boolean;
} {
  const query = new URLSearchParams(search);
  const requestedMode = query.get('mode');
  const fixedMode = validModes.includes(requestedMode as LiveDisplayMode) ? (requestedMode as LiveDisplayMode) : null;
  const explicitRotate = query.get('rotate') === '1' || query.get('rotate') === 'true';
  return { fixedMode, explicitRotate, autoRotate: fixedMode === null || explicitRotate };
}

export function makeSlides(snapshot: IPublicLiveSnapshot, fixedMode: LiveDisplayMode | null): DisplaySlide[] {
  const rowsPerSlide = Math.max(1, Math.min(50, snapshot.settings.rowsPerSlide));
  const modes: LiveDisplayMode[] = fixedMode ? [fixedMode] : enabledModes(snapshot);
  const slides: DisplaySlide[] = [];
  for (const mode of modes) {
    if (mode === 'standings') slides.push(...teamSlides(snapshot, rowsPerSlide));
    if (mode === 'individuals') slides.push(...individualSlides(snapshot, rowsPerSlide));
    if (mode === 'pools') slides.push(...poolSlides(snapshot, rowsPerSlide));
    if (mode === 'results') slides.push(...resultSlides(snapshot, rowsPerSlide));
    if (mode === 'next-round') slides.push(...nextRoundSlides(snapshot, rowsPerSlide));
  }
  return slides;
}

function enabledModes(snapshot: IPublicLiveSnapshot): LiveDisplayMode[] {
  const enabled: LiveDisplayMode[] = [];
  if (snapshot.settings.slides.teamStandings) enabled.push('standings');
  if (snapshot.settings.slides.individuals) enabled.push('individuals');
  if (snapshot.settings.slides.pools) enabled.push('pools');
  if (snapshot.settings.slides.recentResults) enabled.push('results');
  if (snapshot.settings.slides.nextRound && snapshot.nextRound) enabled.push('next-round');
  return enabled;
}

function teamSlides(snapshot: IPublicLiveSnapshot, rowsPerSlide: number): DisplaySlide[] {
  return pages(snapshot.teamStandings, rowsPerSlide).map((rows, index, all) => ({
    kind: 'standings',
    title: 'Team standings',
    eyebrow: 'Aggregate standings',
    page: index + 1,
    pageCount: all.length,
    teams: rows,
  }));
}

function individualSlides(snapshot: IPublicLiveSnapshot, rowsPerSlide: number): DisplaySlide[] {
  const rows = snapshot.individualStandings;
  if (rows.length === 0)
    return [
      {
        kind: 'individuals',
        title: 'Individual leaders',
        eyebrow: 'Individual statistics',
        page: 1,
        pageCount: 1,
        individuals: [],
      },
    ];
  return pages(rows, rowsPerSlide).map((page, index, all) => ({
    kind: 'individuals',
    title: 'Individual leaders',
    eyebrow: 'Individual statistics',
    page: index + 1,
    pageCount: all.length,
    individuals: page,
  }));
}

function poolSlides(snapshot: IPublicLiveSnapshot, rowsPerSlide: number): DisplaySlide[] {
  const slides: DisplaySlide[] = [];
  for (const phase of snapshot.phaseStandings) {
    for (const pool of phase.pools) {
      const poolPages = pages(pool.teams, rowsPerSlide);
      poolPages.forEach((teams, index) =>
        slides.push({
          kind: 'pools',
          title: pool.poolName,
          eyebrow: phase.phaseName,
          page: index + 1,
          pageCount: poolPages.length,
          pool: { ...pool, teams },
        }),
      );
    }
  }
  if (slides.length === 0)
    return [
      {
        kind: 'pools',
        title: 'Pool standings',
        eyebrow: 'Phase standings',
        page: 1,
        pageCount: 1,
        pool: { poolName: 'No pools', teams: [] },
      },
    ];
  return slides;
}

function resultSlides(snapshot: IPublicLiveSnapshot, rowsPerSlide: number): DisplaySlide[] {
  if (snapshot.recentResults.length === 0)
    return [
      { kind: 'results', title: 'Recent results', eyebrow: 'Accepted games', page: 1, pageCount: 1, results: [] },
    ];
  return pages(snapshot.recentResults, rowsPerSlide).map((results, index, all) => ({
    kind: 'results',
    title: 'Recent results',
    eyebrow: 'Accepted games',
    page: index + 1,
    pageCount: all.length,
    results,
  }));
}

function nextRoundSlides(snapshot: IPublicLiveSnapshot, rowsPerSlide: number): DisplaySlide[] {
  if (!snapshot.nextRound) {
    return [
      {
        kind: 'next-round',
        title: 'Next round',
        eyebrow: 'Released room assignments',
        page: 1,
        pageCount: 1,
        assignments: [],
      },
    ];
  }
  return pages(snapshot.nextRound.assignments, rowsPerSlide).map((assignments, index, all) => ({
    kind: 'next-round',
    title: `Round ${snapshot.nextRound?.round.number}`,
    eyebrow: 'Released room assignments',
    page: index + 1,
    pageCount: all.length,
    assignments,
    roundName: snapshot.nextRound?.round.name,
  }));
}

export function pages<T>(rows: T[], pageSize: number): T[][] {
  if (rows.length === 0) return [[]];
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += pageSize) result.push(rows.slice(i, i + pageSize));
  return result;
}

function formatNumber(value: number | null, digits: number): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatPct(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

function formatScore(result: IPublicRecentResult): string {
  if (result.result === 'not-played') return 'Not played';
  if (result.result === 'forfeit') return 'Forfeit';
  const left = result.leftScore === null ? '—' : String(result.leftScore);
  const right = result.rightScore === null ? '—' : String(result.rightScore);
  return `${left}–${right}${result.overtime ? ' OT' : ''}`;
}

function resultLabel(result: IPublicRecentResult): string {
  if (result.result === 'tie') return 'Tie';
  if (result.result === 'forfeit') return 'Forfeit';
  if (result.result === 'not-played') return 'Not played';
  return result.result === 'left' ? 'Left wins' : 'Right wins';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  } else {
    const request = document.documentElement.requestFullscreen?.();
    request?.catch(() => undefined);
  }
}
