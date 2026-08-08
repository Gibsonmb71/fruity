import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy, OpenInNew, Print, Refresh, Settings, QrCode2 } from '@mui/icons-material';
import { TournamentManager } from '../../TournamentManager';
import Tournament from '../../DataModel/Tournament';
import { formatPairingCode, TournamentRoom } from '../../DataModel/TournamentRoom';
import {
  helpRequestCategoryLabels,
  IHelpRequest,
  IRoomPresence,
  ISessionSummary,
  SessionStatus,
} from '../../../main/server/ServerTypes';
import RoomQr from './RoomQr';
import { applyRebalance, planRoomDisable } from '../../Services/RoomAllocationService';
import { YfHelpPopover } from '../../Utils/GeneralReactUtils';

export interface IConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog(props: IConfirmDialogProps) {
  const { open, title, message, confirmLabel, destructive, onClose, onConfirm } = props;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface IRoomEditorDialogProps {
  open: boolean;
  room: TournamentRoom | null;
  tournament: Tournament;
  manager: TournamentManager;
  onClose: () => void;
}

export function RoomEditorDialog(props: IRoomEditorDialogProps) {
  const { open, room, tournament, manager, onClose } = props;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? '');
    setDescription(room?.description ?? '');
    setEnabled(room?.enabled ?? true);
    setError('');
  }, [open, room]);

  const save = async () => {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('Room name is required.');
      return;
    }

    if (room) {
      if (room.enabled && !enabled) {
        const applied = applyRebalance(tournament, planRoomDisable(tournament, room.id, 'leave-unassigned'));
        if (!applied.ok) {
          setError(applied.issues[0]?.message ?? 'The room could not be disabled safely.');
          return;
        }
      }
      room.name = trimmedName;
      room.description = description.trim();
      if (enabled) room.enabled = true;
    } else {
      const created = new TournamentRoom(trimmedName, tournament.rooms.length);
      created.description = description.trim();
      created.enabled = enabled;
      tournament.rooms.push(created);
      TournamentRoom.ensureUniquePairingCodes(tournament.rooms);
    }
    const modeResult = await manager.setRoomScoringMode('browser');
    if (!modeResult.ok) {
      setError(modeResult.reason ?? 'Browser room scoring could not be enabled.');
      return;
    }
    manager.markTournamentDataChanged();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{room ? `Edit ${room.name}` : 'Add tournament room'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Room name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="English Hall"
            helperText="Optional location note for the director."
            fullWidth
          />
          <FormControlLabel
            control={<Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
            label="Room is enabled for new assignments"
          />
          {error !== '' && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>
          {room ? 'Save room' : 'Add room'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface IRoomDetailDialogProps {
  open: boolean;
  room: TournamentRoom | null;
  tournament: Tournament;
  manager: TournamentManager;
  serverAddress: string;
  sessions: ISessionSummary[];
  // eslint-disable-next-line react/require-default-props
  presence?: IRoomPresence;
  // eslint-disable-next-line react/require-default-props
  helpRequest?: IHelpRequest;
  onClose: () => void;
  onEdit: (room: TournamentRoom) => void;
  onCopyUrl: (room: TournamentRoom) => void;
  onCopyPairingCode: (room: TournamentRoom) => void;
  onPrintRoom: (room: TournamentRoom) => void;
  onShowQr: (room: TournamentRoom) => void;
  onRegenerate: (room: TournamentRoom) => void;
  onRegeneratePairingCode: (room: TournamentRoom) => void;
}

export function RoomDetailDialog(props: IRoomDetailDialogProps) {
  const {
    open,
    room,
    tournament,
    manager,
    serverAddress,
    sessions,
    presence,
    helpRequest,
    onClose,
    onEdit,
    onCopyUrl,
    onCopyPairingCode,
    onPrintRoom,
    onShowQr,
    onRegenerate,
    onRegeneratePairingCode,
  } = props;
  const session = room
    ? sessions
        .filter(
          (candidate) =>
            candidate.roomId === room.id &&
            candidate.status !== SessionStatus.Accepted &&
            candidate.status !== SessionStatus.Rejected,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  const schedule = room
    ? tournament.scheduledMatches
        .filter((match) => match.roomId === room.id)
        .slice()
        .sort((a, b) => a.roundNumber - b.roundNumber)
    : [];
  if (!room) return null;

  const url = serverAddress === '' ? '' : room.url(serverAddress);
  const currentMatch = schedule.find((match) => !match.isResolved());
  const scoreSuffix = session?.score
    ? ` · Q${session.score.tossupsRead} · ${session.score.leftPoints}–${session.score.rightPoints}`
    : '';
  let checkInLabel = 'No check-in recorded';
  if (presence?.connected) {
    checkInLabel = `Connected · last check-in ${new Date(presence.lastSeenAt ?? '').toLocaleTimeString()}`;
  } else if (presence?.lastSeenAt) {
    checkInLabel = `Offline · last check-in ${new Date(presence.lastSeenAt).toLocaleTimeString()}`;
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <span>{room.name}</span>
          <Typography variant="caption" color={room.enabled ? 'success.main' : 'text.secondary'}>
            {room.enabled ? 'Enabled' : 'Disabled'}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <div className="rooms-dialog-section">
          <Typography variant="body2" color="text.secondary">
            {room.description || 'No description'}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            {checkInLabel}
          </Typography>
          {presence?.devices && presence.devices.length > 0 && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              {presence.devices.filter((device) => device.connected).length} connected ·{' '}
              {presence.readyDeviceCount ?? 0} ready
              {' · '}
              {presence.devices
                .map(
                  (device) => `${device.operatorName || 'Unnamed operator'} (${device.ready ? 'Ready' : 'Connected'})`,
                )
                .join(', ')}
            </Typography>
          )}
        </div>

        <div className="rooms-dialog-section">
          <h3>Current</h3>
          {session && (
            <Typography variant="body2">
              Round {session.roundNumber} · {session.leftTeam} vs {session.rightTeam}
              {scoreSuffix}
            </Typography>
          )}
          {!session && currentMatch && (
            <Typography variant="body2">
              Round {currentMatch.roundNumber} · {currentMatch.describe()} · Waiting
            </Typography>
          )}
          {!session && !currentMatch && (
            <Typography variant="body2" color="text.secondary">
              No open game in this room.
            </Typography>
          )}
        </div>

        <div className="rooms-dialog-section rooms-pairing-summary">
          <h3>
            Pair this room
            <YfHelpPopover topic="control.pairing-code" label="Help for pairing codes" />
          </h3>
          <Typography variant="body2" color="text.secondary">
            On a new browser, open <strong>/join</strong> and enter this code. The code is not the room&apos;s access
            credential.
          </Typography>
          <Typography variant="h4" sx={{ fontFamily: 'monospace', letterSpacing: 2, my: 1 }}>
            {formatPairingCode(room.pairingCode)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<ContentCopy />} onClick={() => onCopyPairingCode(room)}>
              Copy pairing code
            </Button>
            <Button size="small" startIcon={<Refresh />} onClick={() => onRegeneratePairingCode(room)}>
              New pairing code
            </Button>
          </Stack>
        </div>

        {helpRequest && helpRequest.status === 'open' && (
          <div className="rooms-dialog-section">
            <h3>Needs help</h3>
            <Typography variant="body2">
              {helpRequestCategoryLabels[helpRequest.category]}
              {helpRequest.operatorName ? ` · ${helpRequest.operatorName}` : ''}
            </Typography>
            {helpRequest.currentMatchup && (
              <Typography variant="body2" color="text.secondary">
                {helpRequest.currentMatchup.roundName} · {helpRequest.currentMatchup.leftTeam} vs{' '}
                {helpRequest.currentMatchup.rightTeam}
              </Typography>
            )}
            {helpRequest.message && <Typography variant="body2">{helpRequest.message}</Typography>}
          </div>
        )}

        <div className="rooms-dialog-section">
          <h3>
            Advanced access
            <YfHelpPopover topic="control.reset-room-access" label="Help for resetting room access" />
          </h3>
          <Typography variant="body2" color="text.secondary">
            Resetting access disconnects previously paired browsers and invalidates old QR codes. It does not change the
            pairing code or tournament results.
          </Typography>
          <Button sx={{ mt: 1 }} startIcon={<Refresh />} color="warning" onClick={() => onRegenerate(room)}>
            Reset room access…
          </Button>
        </div>

        <div className="rooms-dialog-section">
          <h3>Schedule</h3>
          {schedule.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No games assigned to this room.
            </Typography>
          ) : (
            <div className="rooms-table-wrap">
              <table className="rooms-table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Match</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((match) => (
                    <tr key={match.id}>
                      <td>{match.roundNumber}</td>
                      <td>{match.describe()}</td>
                      <td>{match.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<Settings />} onClick={() => onEdit(room)}>
          Edit room
        </Button>
        <Button startIcon={<ContentCopy />} onClick={() => onCopyUrl(room)} disabled={url === ''}>
          Copy QR link
        </Button>
        <Button startIcon={<Print />} onClick={() => onPrintRoom(room)}>
          Print room sheet
        </Button>
        <Button
          startIcon={<OpenInNew />}
          onClick={() => url !== '' && manager.launchWebPageInBrowserWindow(url)}
          disabled={url === ''}
        >
          Open room
        </Button>
        <Button startIcon={<QrCode2 />} onClick={() => onShowQr(room)}>
          Show QR
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

interface IRoomQrDialogProps {
  open: boolean;
  room: TournamentRoom | null;
  serverAddress: string;
  onClose: () => void;
}

export function RoomQrDialog({ open, room, serverAddress, onClose }: IRoomQrDialogProps) {
  if (!room) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{room.name} room QR</DialogTitle>
      <DialogContent sx={{ textAlign: 'center' }}>
        <RoomQr room={room} serverAddress={serverAddress} />
        <Typography variant="body2" sx={{ mt: 1 }}>
          Pairing code: <strong>{formatPairingCode(room.pairingCode)}</strong>
        </Typography>
        <Typography variant="caption" component="div" sx={{ mt: 0.5 }} color="text.secondary">
          Scan this code or open <strong>/join</strong> and enter the pairing code.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

interface IRoomSetupDialogProps {
  open: boolean;
  rooms: TournamentRoom[];
  tournamentName: string;
  /** The origin printed on the sheet: the preferred hostname when there is one. */
  serverAddress: string;
  /**
   * The numeric LAN address, when it is not what the sheet is printed with.
   *
   * Printed underneath as a fallback rather than hidden: a hostname that the room devices cannot
   * resolve leaves a scorekeeper holding a piece of paper with no way forward, and the numeric
   * address is the way forward.
   */
  // eslint-disable-next-line react/require-default-props
  fallbackAddress?: string;
  // eslint-disable-next-line react/require-default-props
  autoPrintRoomId?: string | null;
  onClose: () => void;
}

export function RoomSetupDialog({
  open,
  rooms,
  tournamentName,
  serverAddress,
  fallbackAddress,
  autoPrintRoomId = null,
  onClose,
}: IRoomSetupDialogProps) {
  const [printRoomId, setPrintRoomId] = useState<string | null>(null);
  const joinUrl = serverAddress === '' ? '/join' : `${serverAddress.replace(/\/$/, '')}/join`;
  const fallbackCandidate =
    fallbackAddress === undefined || fallbackAddress === '' ? '' : `${fallbackAddress.replace(/\/$/, '')}/join`;
  const fallbackJoinUrl = fallbackCandidate === joinUrl ? '' : fallbackCandidate;

  useEffect(() => {
    const clearPrintSelection = () => setPrintRoomId(null);
    window.addEventListener('afterprint', clearPrintSelection);
    return () => window.removeEventListener('afterprint', clearPrintSelection);
  }, []);

  useEffect(() => {
    if (!open || !autoPrintRoomId) return undefined;
    setPrintRoomId(autoPrintRoomId);
    const handle = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(handle);
  }, [autoPrintRoomId, open]);

  const print = (roomId: string | null = null) => {
    setPrintRoomId(roomId);
    window.setTimeout(() => window.print(), 0);
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Room setup</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          One room per printed page. Scan the QR code, or open the join URL and enter the pairing code.
        </Typography>
        {rooms.length === 0 ? (
          <Alert severity="info">Add rooms before printing the setup sheet.</Alert>
        ) : (
          <div className="rooms-qr-grid" data-print-room={printRoomId ?? ''}>
            {rooms.map((room) => (
              <div
                className={`rooms-qr-card${printRoomId === room.id ? ' is-print-selected' : ''}`}
                data-room-id={room.id}
                key={room.id}
              >
                <p className="rooms-qr-tournament">{tournamentName}</p>
                <h2>{room.name}</h2>
                <RoomQr room={room} serverAddress={serverAddress} />
                <div className="rooms-qr-code">{formatPairingCode(room.pairingCode)}</div>
                <div className="rooms-qr-url">{joinUrl}</div>
                {fallbackJoinUrl !== '' && <div className="rooms-qr-url-fallback">or {fallbackJoinUrl}</div>}
                <Button size="small" onClick={() => print(room.id)}>
                  Print this room
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => print()} disabled={rooms.length === 0}>
          Print all room sheets
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
