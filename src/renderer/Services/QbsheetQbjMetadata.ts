/**
 * Where an imported result says it came from, across three generations of QBSheet output.
 *
 * # Why this is one function and not three importers
 *
 * Reconciliation — backup, conflict, stale revision, candidate — is a single body of rules in
 * `ScheduledResultReconciliation`, and all of it keys off one metadata record. The three forms a
 * result can arrive in differ only in *where* that record's fields are written:
 *
 *   - an official serialized QBJ puts the identity in standard objects: `Tournament.id`,
 *     `Match.id`, `Round.name`, with the round revision in the `_qbtcp` extension on the Match
 *   - a QBSheet result downloaded before this migration puts it in `_qbsheet_source`
 *   - one downloaded before QBSheet was named puts it in `_scoresheet_source`
 *
 * So this normalizes all three into the same record and the rules stay in one place. The
 * alternative — a second reconciliation path for the QBJ form — is how "the automatic result and
 * the manual backup disagree" becomes a bug that only happens on one of them.
 *
 * # Read before case conversion
 *
 * `MatchImportService` calls this on the raw parsed JSON, before `snakeCaseToCamelCase` runs. That
 * matters: the conversion recurses into every nested object, and while it leaves `_qbtcp` alone
 * today, reading first means this does not depend on that continuing to be true.
 */
import { portableResultFingerprint, readSourceMetadata, readQbtcpExtension, type IQbjSourceMetadata } from 'qbsheet';

export const qbsheetSourceExtensionKey = '_qbsheet_source';
export type IQbsheetQbjSourceMetadata = IQbjSourceMetadata;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The objects array of an official serialized document, or null for anything else. */
function serializedObjects(value: unknown): Record<string, unknown>[] | null {
  if (!isPlainObject(value) || !Array.isArray(value.objects)) return null;
  return value.objects.filter(isPlainObject);
}

/**
 * The round number a serialized document's match belongs to.
 *
 * `Round.name` is the numeric string for an ordinary round — that is what the reference
 * implementation writes and what `FileParser` resolves rounds by. A non-numeric round ("Playoff 2")
 * yields nothing here rather than a wrong number, and the import falls back to matching on teams.
 */
function roundNumberForMatch(objects: Record<string, unknown>[], matchId: string): number | undefined {
  const refersToMatch = (matches: unknown): boolean =>
    Array.isArray(matches) &&
    matches.some(
      (entry) => (isPlainObject(entry) && entry.$ref === matchId) || (isPlainObject(entry) && entry.id === matchId),
    );

  const rounds: Record<string, unknown>[] = [];
  for (const entry of objects) {
    if (entry.type === 'Round') rounds.push(entry);
    const phases = Array.isArray(entry.phases) ? entry.phases : [];
    for (const phase of phases) {
      if (!isPlainObject(phase)) continue;
      for (const round of Array.isArray(phase.rounds) ? phase.rounds : []) {
        if (isPlainObject(round)) rounds.push(round);
      }
    }
  }

  for (const round of rounds) {
    if (!refersToMatch(round.matches)) continue;
    const parsed = Number.parseInt(String(round.name), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Read an official serialized result as the same metadata record the legacy blocks produce.
 *
 * Returns null when the document is not a serialized QBJ or carries no match identity — there is
 * nothing to synthesize from, and a record with invented fields would be worse than none.
 */
function readSerializedIdentity(value: unknown): IQbsheetQbjSourceMetadata | null {
  const objects = serializedObjects(value);
  if (!objects) return null;

  const tournament = objects.find((entry) => entry.type === 'Tournament');
  const match = objects.find((entry) => entry.type === 'Match');
  if (!match || typeof match.id !== 'string' || match.id === '') return null;

  const roundNumber = roundNumberForMatch(objects, match.id);
  if (roundNumber === undefined) return null;

  const extension = readQbtcpExtension(match);

  return {
    producer: 'QBSheet',
    // The legacy field name. Kept at 1 because it gates the reconciliation rules, and those rules
    // are unchanged: this is the same information reaching them by a standard route.
    gamePackageVersion: 1,
    ...(typeof tournament?.id === 'string' && tournament.id !== '' ? { tournamentId: tournament.id } : {}),
    tournamentName: typeof tournament?.name === 'string' ? tournament.name : 'Imported tournament',
    // Match.id is the scheduled game. This is the strongest identity a result can carry, and the
    // whole reason an assignment preserves it into its result.
    scheduledMatchId: match.id,
    roundNumber,
    // A document with no extension has no revision to claim. 1 is the identity value -- the first
    // issue of these pairings -- and is what a generic QBJ from another tool amounts to.
    roundRevision: extension?.roundRevision ?? 1,
    ...(typeof match.location === 'string' && match.location !== '' ? { roomName: match.location } : {}),
    resultFingerprint: portableResultFingerprint(match),
  };
}

/**
 * Read the source metadata, whichever generation wrote it.
 *
 * The legacy blocks are tried first because a document carrying one is explicitly claiming that
 * identity, and a serialized result that also carried one would mean the producer said the same
 * thing twice.
 */
export function readQbsheetSourceMetadata(value: unknown): IQbsheetQbjSourceMetadata | null {
  return readSourceMetadata(value) ?? readSerializedIdentity(value);
}

/** Use QBSheet's canonical portable-result fingerprint for backup reconciliation. */
export function qbsheetResultFingerprint(value: unknown): string {
  return portableResultFingerprint(value as object);
}
