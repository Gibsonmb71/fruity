import { IRoomDescriptor, IRoomDevicePresence, IRoomPresence, staleRoomThresholdMs } from './ServerTypes';

interface IPresenceRecord extends IRoomDevicePresence {
  lastSeenMs: number;
}

function cleanLabel(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return cleaned || undefined;
}

function toPublic(record: IPresenceRecord, nowMs: number): IRoomDevicePresence {
  const msSinceLastSeen = Math.max(0, nowMs - record.lastSeenMs);
  return {
    roomId: record.roomId,
    deviceId: record.deviceId,
    operatorName: record.operatorName,
    lastSeenAt: record.lastSeenAt,
    msSinceLastSeen,
    connected: msSinceLastSeen <= staleRoomThresholdMs,
    ready: record.ready,
  };
}

/** In-memory presence/readiness for all browsers connected to the current local server. */
export default class PresenceStore {
  private records = new Map<string, Map<string, IPresenceRecord>>();

  checkIn(
    roomId: string,
    deviceId: string,
    operatorName?: string,
    ready?: boolean,
    nowMs = Date.now(),
  ): IRoomDevicePresence {
    const normalizedDeviceId = deviceId.trim().slice(0, 128) || 'unidentified';
    const roomRecords = this.records.get(roomId) ?? new Map<string, IPresenceRecord>();
    const previous = roomRecords.get(normalizedDeviceId);
    const record: IPresenceRecord = {
      roomId,
      deviceId: normalizedDeviceId,
      operatorName: cleanLabel(operatorName, 80) ?? previous?.operatorName,
      lastSeenAt: new Date(nowMs).toISOString(),
      lastSeenMs: nowMs,
      msSinceLastSeen: 0,
      connected: true,
      ready: ready ?? previous?.ready ?? false,
    };
    roomRecords.set(normalizedDeviceId, record);
    this.records.set(roomId, roomRecords);
    return toPublic(record, nowMs);
  }

  updateReady(roomId: string, deviceId: string, ready: boolean, nowMs = Date.now()): IRoomDevicePresence {
    return this.checkIn(roomId, deviceId, undefined, ready, nowMs);
  }

  getRoom(room: IRoomDescriptor, nowMs = Date.now()): IRoomPresence {
    const devices = Array.from(this.records.get(room.id)?.values() ?? [])
      .map((record) => toPublic(record, nowMs))
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
    const connectedDevices = devices.filter((device) => device.connected);
    const latest = devices.reduce<IRoomDevicePresence | null>(
      (candidate, device) =>
        !candidate || new Date(device.lastSeenAt).getTime() > new Date(candidate.lastSeenAt).getTime()
          ? device
          : candidate,
      null,
    );
    return {
      roomId: room.id,
      lastSeenAt: latest?.lastSeenAt ?? null,
      msSinceLastSeen: latest?.msSinceLastSeen ?? null,
      connected: connectedDevices.length > 0,
      devices,
      readyDeviceCount: connectedDevices.filter((device) => device.ready).length,
    };
  }

  getAll(rooms: IRoomDescriptor[], nowMs = Date.now()): IRoomPresence[] {
    return rooms.map((room) => this.getRoom(room, nowMs));
  }

  clear(): void {
    this.records.clear();
  }
}
