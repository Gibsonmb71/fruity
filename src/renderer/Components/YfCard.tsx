import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import React from 'react';
import { YfHelpPopover } from '../Utils/GeneralReactUtils';
import { HelpTopicId } from './PageLevelHelpText';

/** How a panel pads its body. */
export type YfCardVariant =
  /** Padding on all sides — the default, for form fields and prose. */
  | 'default'
  /** Horizontal padding only — for a `SettingsList`, whose rows supply their own vertical rhythm. */
  | 'rows'
  /** No padding — for a full-bleed table or list that draws its own edges. */
  | 'flush';

const bodyPadding: Record<YfCardVariant, object | undefined> = {
  default: { px: 2, py: 1.5 },
  rows: { px: 2 },
  flush: undefined,
};

interface IYfCardProps {
  title: React.JSX.Element | string;
  /** Controls belonging to the panel as a whole, shown opposite the title. */
  // eslint-disable-next-line react/require-default-props
  actions?: React.ReactNode;
  /** Short line of explanatory text under the title. */
  // eslint-disable-next-line react/require-default-props
  description?: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  variant?: YfCardVariant;
  /** Fill the height of its grid/flex track, so panels sitting side by side line up. */
  // eslint-disable-next-line react/require-default-props
  fullHeight?: boolean;
  /** Targeted help for what this whole panel configures. Omit unless the panel is genuinely unobvious. */
  // eslint-disable-next-line react/require-default-props
  helpTopic?: HelpTopicId;
}

/**
 * The standard bordered panel, and the only one — every page groups its content with these rather
 * than with per-page `sx`. Low-contrast 1px border, no elevation, compact header: the containment
 * comes from the border, not from a shadow.
 */
function YfCard(props: React.PropsWithChildren<IYfCardProps>) {
  const { title, children, actions, description, variant = 'default', fullHeight, helpTopic } = props;
  return (
    <Paper
      variant="outlined"
      sx={{ overflow: 'hidden', ...(fullHeight ? { height: '100%', display: 'flex', flexDirection: 'column' } : {}) }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h2" sx={{ fontSize: '0.875rem' }}>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
              {title}
              {helpTopic && (
                <YfHelpPopover
                  topic={helpTopic}
                  label={typeof title === 'string' ? `Help for ${title}` : 'Show help'}
                />
              )}
            </Box>
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {description}
            </Typography>
          )}
        </Box>
        {actions && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {actions}
          </Stack>
        )}
      </Box>
      <Box sx={{ ...bodyPadding[variant], ...(fullHeight ? { flexGrow: 1 } : {}) }}>{children}</Box>
    </Paper>
  );
}

export default YfCard;
