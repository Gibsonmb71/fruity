import { useContext, useEffect, useState } from 'react';
import { Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { CheckCircleOutlined } from '@mui/icons-material';
import YfCard from './YfCard';
import { getTemplateList, sizesWithTemplates, getStdSchedule } from '../DataModel/ScheduleUtils';
import StandardSchedule from '../DataModel/StandardSchedule';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { SettingRow, SettingsList } from '../Utils/GeneralReactUtils';

interface ISchedulePickerCardProps {
  /** The configured-format page opens this only after the director chooses Change. */
  // eslint-disable-next-line react/require-default-props
  forceOpen?: boolean;
  // eslint-disable-next-line react/require-default-props
  onApplied?: () => void;
}

export default function SchedulePickerCard({ forceOpen = false, onApplied }: ISchedulePickerCardProps) {
  const tournManager = useContext(TournamentContext);
  const [size, setSize] = useState<number | string>('');
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>('');
  const [previewedSchedule, setPreviewedSchedule] = useState<StandardSchedule | null>(null);
  const [numTeamsRegistered] = useSubscription(tournManager.tournament.getNumberOfTeams());
  const [phases] = useSubscription(tournManager.tournament.phases);
  const readOnly = tournManager.tournament.hasMatchData;

  useEffect(() => {
    if (phases.length > 0 && !forceOpen) return;
    const suggestedSize = sizesWithTemplates.find((value) => value >= Math.max(numTeamsRegistered, 1));
    setSize(suggestedSize ?? '');
    setSelectedTemplateName('');
    setPreviewedSchedule(null);
  }, [forceOpen, numTeamsRegistered, phases.length]);

  const handleSizeChange = (val: number | string) => {
    setSize(val);
    setSelectedTemplateName('');
    setPreviewedSchedule(null);
  };

  const handleTemplateChange = (val: string) => {
    setSelectedTemplateName(val);
    setPreviewedSchedule(val === '' ? null : getStdSchedule(val, size));
  };

  const applySchedule = () => {
    if (previewedSchedule === null) return;
    tournManager.setStandardSchedule(previewedSchedule);
    onApplied?.();
  };

  if (phases.length > 0 && !forceOpen) return null;

  return (
    <YfCard
      title="Tournament Format"
      description={
        forceOpen
          ? 'Change the standard format or choose another template.'
          : 'Choose the structure for this tournament.'
      }
    >
      <Stack spacing={1.5}>
        <FormControl fullWidth>
          <InputLabel>Field size</InputLabel>
          <Select
            label="Field size"
            disabled={readOnly}
            value={size}
            onChange={(event) => handleSizeChange(event.target.value)}
          >
            {sizesWithTemplates.map((value) => (
              <MenuItem key={value} value={value} disabled={value < numTeamsRegistered}>
                {value} teams
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel>Format</InputLabel>
          <Select
            label="Format"
            value={selectedTemplateName}
            disabled={size === '' || readOnly}
            onChange={(event) => handleTemplateChange(event.target.value)}
          >
            {getTemplateList(size).map((template) => (
              <MenuItem key={template.shortName} value={template.shortName}>
                {template.shortName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      {previewedSchedule && (
        <FormatPreview
          schedule={previewedSchedule}
          registeredTeams={numTeamsRegistered}
          usesBonuses={tournManager.tournament.scoringRules.useBonuses}
          onApply={applySchedule}
          readOnly={readOnly}
        />
      )}
      <Button
        variant="text"
        size="small"
        sx={{ mt: 1.5, alignSelf: 'flex-start' }}
        disabled={readOnly}
        onClick={() => tournManager.startNewCustomSchedule()}
      >
        Create custom format
      </Button>
    </YfCard>
  );
}

function FormatPreview({
  schedule,
  registeredTeams,
  usesBonuses,
  onApply,
  readOnly,
}: {
  schedule: StandardSchedule;
  registeredTeams: number;
  usesBonuses: boolean;
  onApply: () => void;
  readOnly: boolean;
}) {
  const fieldFits = registeredTeams === 0 || registeredTeams <= schedule.size;
  const rulesCompatible = usesBonuses || !schedule.usesWC;

  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
        {schedule.fullName}
      </Typography>
      {!rulesCompatible && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          This format uses cross-pool ranking based on points per bonus, so the selected rules must include bonuses.
        </Alert>
      )}
      <SettingsList>
        <SettingRow label="Rounds" control={<SummaryValue text={String(schedule.rounds)} />} />
        <SettingRow label="Recommended rooms" control={<SummaryValue text={String(schedule.rooms)} />} />
        <SettingRow label="Minimum games/team" control={<SummaryValue text={String(schedule.minGames)} />} />
        <SettingRow label="Rebracket after" control={<SummaryValue text={rebracketRoundList(schedule)} />} />
      </SettingsList>
      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
        <ReadinessLine valid={fieldFits} text="Registered field fits" />
        <ReadinessLine valid={rulesCompatible} text="Format is compatible with the ruleset" />
      </Stack>
      <Button
        fullWidth
        variant="contained"
        sx={{ mt: 1.5 }}
        onClick={onApply}
        disabled={readOnly || !fieldFits || !rulesCompatible}
      >
        Use format
      </Button>
    </Box>
  );
}

function ReadinessLine({ valid, text }: { valid: boolean; text: string }) {
  return (
    <Typography
      variant="body2"
      color={valid ? 'success.main' : 'warning.main'}
      sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}
    >
      <CheckCircleOutlined sx={{ fontSize: 16 }} />
      {text}
    </Typography>
  );
}

function SummaryValue({ text }: { text: string }) {
  return (
    <Typography variant="body2" sx={{ fontWeight: 500 }}>
      {text}
    </Typography>
  );
}

function rebracketRoundList(schedule: StandardSchedule) {
  if (schedule.rebracketAfter.length === 0) return 'None';
  return schedule.rebracketAfter.map((round) => `Round ${round}`).join(', ');
}
