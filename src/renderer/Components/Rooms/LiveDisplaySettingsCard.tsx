import { useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy, Launch, QrCode2 } from '@mui/icons-material';
import QRCode from 'qrcode';
import { TournamentContext } from '../../TournamentManager';
import { TournamentServerContext } from '../../Services/TournamentServerService';
import { YfHelpPopover } from '../../Utils/GeneralReactUtils';
import type { ILiveDisplaySettings } from '../../../shared/LiveTypes';

const durationOptions = [5, 10, 15, 20, 30] as const;

export default function LiveDisplaySettingsCard() {
  const manager = useContext(TournamentContext);
  const service = useContext(TournamentServerContext);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  if (!service) return null;

  // Use the same interface the room setup and QR sheets advertise. The first detected interface
  // is not necessarily reachable by spectators when the laptop has Wi-Fi and Ethernet enabled.
  const address = service.selectedAddress;
  const audienceUrl = address === '' ? '' : `${address.replace(/\/+$/, '')}/live`;
  const displayUrl = address === '' ? '' : `${address.replace(/\/+$/, '')}/live/display`;
  const pairingsUrl = address === '' ? '' : `${address.replace(/\/+$/, '')}/live/pairings`;
  const settings = manager.tournament.liveDisplaySettings;

  const update = (change: (current: ILiveDisplaySettings) => void) => {
    change(settings);
    manager.markTournamentDataChanged();
  };

  const copy = async (url: string) => {
    if (url === '') return;
    try {
      await navigator.clipboard.writeText(url);
      manager.makeToast('Copied to clipboard');
    } catch (_error) {
      manager.makeToast('Could not copy URL', 'error');
    }
  };

  return (
    <>
      <section className="rooms-panel" aria-labelledby="live-display-heading">
        <div className="rooms-panel-header">
          <div>
            <h2 id="live-display-heading">Live audience and display</h2>
            <p>Publish a read-only tournament view for spectators, a hallway screen, or a Smart Board.</p>
          </div>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.enabled}
                onChange={(event) =>
                  update((current) => {
                    current.enabled = event.target.checked;
                  })
                }
              />
            }
            label={
              <span>
                Live display enabled <YfHelpPopover topic="control.live-display" label="Help for the live display" />
              </span>
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.publicPairingsEnabled === true}
                onChange={(event) =>
                  update((current) => {
                    current.publicPairingsEnabled = event.target.checked;
                  })
                }
              />
            }
            label={
              <span>
                Public pairings enabled{' '}
                <YfHelpPopover topic="control.public-pairings" label="Help for public pairings" />
              </span>
            }
          />
        </div>
        <div className="rooms-live-settings-body">
          <div className="rooms-live-setting-column">
            <Typography variant="subtitle2">{settings.enabled ? 'Slides enabled' : 'Display currently off'}</Typography>
            {!settings.enabled && (
              <Typography variant="body2" color="text.secondary">
                These settings are saved for when you turn the live display on.
              </Typography>
            )}
            <Stack spacing={0.25}>
              <SlideCheckbox
                label="Team standings"
                checked={settings.slides.teamStandings}
                onChange={(value) =>
                  update((current) => {
                    current.slides.teamStandings = value;
                  })
                }
              />
              <SlideCheckbox
                label="Individuals"
                checked={settings.slides.individuals}
                onChange={(value) =>
                  update((current) => {
                    current.slides.individuals = value;
                  })
                }
              />
              <SlideCheckbox
                label="Pools"
                checked={settings.slides.pools}
                onChange={(value) =>
                  update((current) => {
                    current.slides.pools = value;
                  })
                }
              />
              <SlideCheckbox
                label="Recent results"
                checked={settings.slides.recentResults}
                onChange={(value) =>
                  update((current) => {
                    current.slides.recentResults = value;
                  })
                }
              />
              <SlideCheckbox
                label="Next-round assignments"
                checked={settings.slides.nextRound}
                onChange={(value) =>
                  update((current) => {
                    current.slides.nextRound = value;
                  })
                }
              />
            </Stack>
          </div>
          <div className="rooms-live-setting-column rooms-live-controls">
            <TextField
              select
              label="Slide duration"
              value={settings.slideDurationSeconds}
              onChange={(event) =>
                update((current) => {
                  current.slideDurationSeconds = Number(
                    event.target.value,
                  ) as ILiveDisplaySettings['slideDurationSeconds'];
                })
              }
              helperText="Used by automatic display rotation."
            >
              {durationOptions.map((seconds) => (
                <MenuItem key={seconds} value={seconds}>
                  {seconds} seconds
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Rows per ranking slide"
              type="number"
              value={settings.rowsPerSlide}
              slotProps={{ htmlInput: { min: 1, max: 50 } }}
              onChange={(event) => {
                const rows = Number(event.target.value);
                if (Number.isFinite(rows))
                  update((current) => {
                    current.rowsPerSlide = Math.max(1, Math.min(50, Math.round(rows)));
                  });
              }}
              helperText="Long lists paginate instead of shrinking."
            />
            <TextField
              select
              label="Theme"
              value={settings.theme}
              onChange={(event) =>
                update((current) => {
                  current.theme = event.target.value as ILiveDisplaySettings['theme'];
                })
              }
            >
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="light">Light</MenuItem>
              <MenuItem value="dark">Dark</MenuItem>
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={settings.showLastUpdated}
                  onChange={(event) =>
                    update((current) => {
                      current.showLastUpdated = event.target.checked;
                    })
                  }
                />
              }
              label="Show last-updated timestamp"
            />
          </div>
        </div>
        <div className="rooms-live-urls">
          <UrlRow
            label="Audience URL"
            url={audienceUrl}
            onCopy={() => copy(audienceUrl)}
            onOpen={() => manager.launchWebPageInBrowserWindow(audienceUrl)}
            onQr={() => setQrUrl(audienceUrl)}
          />
          <UrlRow
            label="Display URL"
            url={displayUrl}
            onCopy={() => copy(displayUrl)}
            onOpen={() => manager.launchWebPageInBrowserWindow(displayUrl)}
            onQr={() => setQrUrl(displayUrl)}
          />
          <UrlRow
            label="Public pairings URL"
            url={pairingsUrl}
            onCopy={() => copy(pairingsUrl)}
            onOpen={() => manager.launchWebPageInBrowserWindow(pairingsUrl)}
            onQr={() => setQrUrl(pairingsUrl)}
          />
          {address === '' && (
            <div className="rooms-inline-message">Start the Tournament Server to generate reachable LAN URLs.</div>
          )}
        </div>
      </section>
      <LiveUrlQrDialog url={qrUrl} onClose={() => setQrUrl(null)} />
    </>
  );
}

function SlideCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormControlLabel
      control={<Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />}
      label={label}
    />
  );
}

function UrlRow({
  label,
  url,
  onCopy,
  onOpen,
  onQr,
}: {
  label: string;
  url: string;
  onCopy: () => void;
  onOpen: () => void;
  onQr: () => void;
}) {
  return (
    <div className="rooms-live-url-row">
      <div>
        <strong>{label}</strong>
        <span>{url || 'Server offline'}</span>
      </div>
      <Stack direction="row" spacing={0.5}>
        <Button size="small" startIcon={<ContentCopy />} onClick={onCopy} disabled={url === ''}>
          Copy URL
        </Button>
        <Button size="small" startIcon={<Launch />} onClick={onOpen} disabled={url === ''}>
          Open
        </Button>
        <Button size="small" startIcon={<QrCode2 />} onClick={onQr} disabled={url === ''}>
          QR
        </Button>
      </Stack>
    </div>
  );
}

function LiveUrlQrDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDataUrl('');
    setError('');
    if (!url) return undefined;
    QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#18202a', light: '#ffffff' },
    })
      .then((next) => {
        if (!cancelled) setDataUrl(next);
        return next;
      })
      .catch(() => {
        if (!cancelled) setError('Could not generate the QR code. Copy the URL instead.');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  let qrContent: ReactNode = <Typography>Generating QR code…</Typography>;
  if (error) qrContent = <Typography color="error">{error}</Typography>;
  else if (dataUrl) {
    qrContent = <img src={dataUrl} alt="QR code for the live URL" style={{ width: 260, height: 260 }} />;
  }

  return (
    <Dialog open={url !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Live URL QR code</DialogTitle>
      <DialogContent sx={{ textAlign: 'center' }}>
        {qrContent}
        <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
          {url}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
