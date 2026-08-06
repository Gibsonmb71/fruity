import { Phase } from '../DataModel/Phase';
import { ScheduledMatch } from '../DataModel/ScheduledMatch';

export interface IMatchPlanStageOption {
  code: string;
  label: string;
}

export function matchesForRoomCell(matches: ScheduledMatch[], roundNumber: number, roomId: string): ScheduledMatch[] {
  return matches.filter(
    (match) =>
      match.roundNumber === roundNumber && (roomId === '__unassigned__' ? !match.roomId : match.roomId === roomId),
  );
}

/** Map persisted phase codes to the human stage names used by the Match Plan filters. */
export function matchPlanStageOptions(phases: Phase[], matches: ScheduledMatch[]): IMatchPlanStageOption[] {
  const phaseNames = new Map(phases.map((phase) => [phase.code, phase.name || phase.code]));
  const codes = Array.from(new Set(matches.map((match) => match.phaseCode).filter((code) => code !== ''))).sort();
  const nameCounts = new Map<string, number>();
  codes.forEach((code) => {
    const name = phaseNames.get(code) ?? code;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  });
  return codes.map((code) => {
    const name = phaseNames.get(code) ?? code;
    return { code, label: (nameCounts.get(name) ?? 0) > 1 ? `${name} · ${code}` : name };
  });
}
