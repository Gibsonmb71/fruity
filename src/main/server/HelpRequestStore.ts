import { randomId } from '../../renderer/Utils/RandomIds';
import {
  HelpRequestCategory,
  HelpRequestState,
  IHelpMatchupContext,
  ICreateHelpRequest,
  IHelpRequest,
  IRoomDescriptor,
} from './ServerTypes';

const validCategories = new Set<HelpRequestCategory>([
  'wrong-matchup',
  'team-missing',
  'protest',
  'question-packet',
  'roster-change',
  'equipment-technical',
  'rules-question',
  'scoring-problem',
  'device-network',
  'wrong-room',
  'other',
]);

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function cleanMatchup(value: IHelpMatchupContext | undefined): IHelpMatchupContext | undefined {
  if (!value || typeof value.roundNumber !== 'number' || !Number.isFinite(value.roundNumber)) return undefined;
  const roundName = cleanText(value.roundName, 120);
  const leftTeam = cleanText(value.leftTeam, 160);
  const rightTeam = cleanText(value.rightTeam, 160);
  if (!roundName || !leftTeam || !rightTeam) return undefined;
  return { roundNumber: value.roundNumber, roundName, leftTeam, rightTeam };
}

/**
 * Help is deliberately an operational signal, not a tournament mutation. It lives in memory and
 * is cleared with the local server; no room can change a match, assignment, or schedule through it.
 */
export default class HelpRequestStore {
  private requests = new Map<string, IHelpRequest>();

  create(room: IRoomDescriptor, input: ICreateHelpRequest, nowMs = Date.now()): IHelpRequest | null {
    const { category } = input;
    if (!validCategories.has(category)) return null;
    const message = cleanText(input.message, 500);
    const deviceId = cleanText(input.deviceId, 128) || undefined;
    const existing = this.getActiveForDevice(room.id, deviceId);
    if (existing) return existing;
    const now = new Date(nowMs).toISOString();
    const request: IHelpRequest = {
      id: randomId('help'),
      roomId: room.id,
      roomName: room.name,
      category,
      message,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      deviceId,
      operatorName: cleanText(input.operatorName, 80) || undefined,
      currentMatchup: cleanMatchup(input.currentMatchup),
    };
    this.requests.set(request.id, request);
    return request;
  }

  list(status?: HelpRequestState): IHelpRequest[] {
    return Array.from(this.requests.values())
      .filter((request) => !status || request.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): IHelpRequest | undefined {
    return this.requests.get(id);
  }

  getOpenForRoom(roomId: string): IHelpRequest | undefined {
    return this.list('open').find((request) => request.roomId === roomId);
  }

  getActiveForDevice(roomId: string, deviceId?: string): IHelpRequest | undefined {
    return this.list('open').find((request) => request.roomId === roomId && request.deviceId === deviceId);
  }

  updateState(
    id: string,
    status: Exclude<HelpRequestState, 'open'>,
    note?: string,
    nowMs = Date.now(),
  ): IHelpRequest | null {
    const request = this.requests.get(id);
    if (!request) return null;
    const updated: IHelpRequest = {
      ...request,
      status,
      updatedAt: new Date(nowMs).toISOString(),
      resolutionNote: cleanText(note, 300) || undefined,
    };
    this.requests.set(id, updated);
    return updated;
  }

  cancelForDevice(roomId: string, deviceId: string, nowMs = Date.now()): IHelpRequest | null {
    const active = this.getActiveForDevice(roomId, deviceId);
    return active ? this.updateState(active.id, 'cancelled', undefined, nowMs) : null;
  }

  clear(): void {
    this.requests.clear();
  }
}
