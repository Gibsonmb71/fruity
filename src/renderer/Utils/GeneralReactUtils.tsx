/* eslint-disable react/jsx-props-no-spreading */
import {
  Box,
  Button,
  ButtonBase,
  ButtonProps,
  Collapse,
  IconButton,
  IconButtonProps,
  Popover,
  Stack,
  styled,
  TextField,
  TextFieldProps,
  Typography,
} from '@mui/material';
import React, { forwardRef, useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import { ExpandMore, HelpOutlined } from '@mui/icons-material';
import { invalidInteger } from './GeneralUtils';
import { getHelpText, HelpTopicId } from '../Components/PageLevelHelpText';

export enum YfCssClasses {
  HotkeyUnderline = 'yf-hotkey-underline',
  DropTarget = 'drop-target',
  Draggable = 'yf-draggable',
  StatReportIFrame = 'stat-report-iframe',
}

/** Turn a string with an ampersand into the string with the letter after the ampersand underlined.
 *  Literal ampersands can be specified with {AMP}
 */
export function hotkeyFormat(caption: string) {
  const splitLoc = caption.indexOf('&');
  if (splitLoc === -1) return <span>{caption}</span>;

  const start = caption.substring(0, splitLoc);
  const uLetter = caption.substring(splitLoc + 1, splitLoc + 2);
  const end = caption.substring(splitLoc + 2);

  return (
    <span>
      {start.replaceAll('{AMP}', '&')}
      <span className={YfCssClasses.HotkeyUnderline}>{uLetter}</span>
      {end.replaceAll('{AMP}', '&')}
    </span>
  );
}

/** Styling for a minimal button that looks like a link */
export const LinkButton = styled(Button)(({ theme }) => ({
  textTransform: 'none',
  padding: 0,
  ...theme.typography.body2,
}));

interface ExpandButtonProps extends IconButtonProps {
  expand: boolean;
}

// from https://mui.com/material-ui/react-card/
export const ExpandButton = styled((props: ExpandButtonProps) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { expand, ...other } = props;
  return <IconButton {...other} />;
})(({ theme, expand }) => ({
  transform: !expand ? 'rotate(0deg)' : 'rotate(180deg)',
  marginLeft: 'auto',
  transition: theme.transitions.create('transform', {
    duration: theme.transitions.duration.shortest,
  }),
}));

interface ICollapsibleAreaProps {
  title: React.JSX.Element | string;
  secondaryTitle: React.JSX.Element | string | null;
}

/** A section that starts hidden and can be expanded */
export function CollapsibleArea(props: React.PropsWithChildren<ICollapsibleAreaProps>) {
  const { title, secondaryTitle, children } = props;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <Grid container sx={{ cursor: 'pointer' }} onClick={() => setIsExpanded(!isExpanded)}>
        <Grid size={{ xs: 'grow' }}>
          {title}
          {!isExpanded && secondaryTitle}
        </Grid>
        <Grid size={{ xs: 'auto' }}>
          <ExpandButton expand={isExpanded} sx={{ py: 0 }}>
            <ExpandMore />
          </ExpandButton>
        </Grid>
      </Grid>
      <Collapse in={isExpanded}>{children}</Collapse>
    </>
  );
}

function numberInputOnWheelPreventChange(e: any) {
  // Prevent the input value change
  e.target.blur();

  // Prevent the page/container scrolling
  e.stopPropagation();

  // Refocus immediately, on the next tick (after the current function is done)
  setTimeout(() => e.target.focus(), 0);
}

/** A numeric field that stops the mouse wheel from changing it */
export function YfNumericField(props: TextFieldProps) {
  const { ...other } = props;
  return <TextField type="number" onWheel={numberInputOnWheelPreventChange} {...other} />;
}

export const YfAcceptButton = forwardRef((props: ButtonProps, buttonRef) => {
  const { ...other } = props;
  return (
    <Button variant="contained" {...other} ref={buttonRef as React.RefObject<HTMLButtonElement>}>
      {hotkeyFormat('&Accept')}
    </Button>
  );
});

export function YfCancelButton(props: ButtonProps) {
  const { ...other } = props;
  return (
    <Button variant="text" {...other}>
      {hotkeyFormat('&Cancel')}
    </Button>
  );
}

/**
 * The one help affordance in the application. Every `?` in the UI is this component.
 *
 * Deliberately a button and not a hover tooltip: help that only appears on hover is unreachable by
 * keyboard and on a touch screen, and it vanishes the moment you move the pointer toward the text
 * you were trying to read. As a popover it is focusable and activatable from the keyboard, Escape
 * and an outside click both close it, and MUI returns focus to the `?` that opened it.
 *
 * Forms should never grow their own version of this. `YfFieldRow`, `YfToggleRow`, `SettingRow`,
 * `YfCard` and `YfPageHeader` all take a `helpTopic` and render this, which is what keeps the icon,
 * the interaction and the accessible name identical everywhere.
 */
// eslint-disable-next-line react/require-default-props
export function YfHelpPopover({ topic, label = 'Show help' }: { topic: HelpTopicId; label?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const contents = getHelpText(topic);
  const open = anchor !== null;
  return (
    <>
      <IconButton
        size="small"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          // Help sits inside clickable rows, accordion summaries and menu items; opening it must
          // never also trigger whatever it is sitting on.
          event.stopPropagation();
          setAnchor(open ? null : event.currentTarget);
        }}
        sx={{ p: 0.25, color: 'text.secondary' }}
      >
        <HelpOutlined sx={{ fontSize: 16 }} />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 360 }, 'aria-label': label } }}
      >
        {contents.map((section) => (
          <Box key={section.header ?? section.content.join('\u0000')} sx={{ '& + &': { mt: 1.25 } }}>
            {section.header && (
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {section.header}
              </Typography>
            )}
            {section.content.map((paragraph) => (
              <Typography key={paragraph} variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
                {paragraph}
              </Typography>
            ))}
          </Box>
        ))}
      </Popover>
    </>
  );
}

/**
 * An accessible name for a help button, from whatever the row uses as its label.
 *
 * A label is often an element rather than a string, and `String(element)` produces
 * "[object Object]", which is what a screen reader would then read out.
 */
function helpLabelFor(label: React.ReactNode): string {
  return typeof label === 'string' ? `Help for ${label}` : 'Show help';
}

interface IYfPageHeaderProps {
  title: string;
  // eslint-disable-next-line react/require-default-props
  description?: string;
  // eslint-disable-next-line react/require-default-props
  actions?: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  status?: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  helpTopic?: HelpTopicId;
}

/** Consistent title block at the top of a page. */
export function YfPageHeader(props: IYfPageHeaderProps) {
  const { title, description, actions, status, helpTopic } = props;
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 3,
        flexWrap: 'wrap',
        mb: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="h1" component="h1">
            {title}
          </Typography>
          {helpTopic && <YfHelpPopover topic={helpTopic} label={`Help for ${title}`} />}
        </Box>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </Box>
      {(actions || status) && (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {status}
          {actions}
        </Stack>
      )}
    </Box>
  );
}

/**
 * A two-track grid for compact desktop form rows: labels in a narrow left column, controls in the
 * right. One grid per panel, so every label lines up and the controls share a left edge instead of
 * each field owning a stacked label of its own.
 *
 * Children should be `YfFieldRow`s — they render as bare grid cells, not as wrappers, which is what
 * keeps the alignment shared across rows.
 */
interface IYfFieldGridProps {
  /** Width of the label track. Widen it when the labels in a panel are long. */
  // eslint-disable-next-line react/require-default-props
  labelWidth?: number;
}

export function YfFieldGrid(props: React.PropsWithChildren<IYfFieldGridProps>) {
  const { labelWidth = 116, children } = props;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `minmax(0, ${labelWidth}px) minmax(0, 1fr)`,
        alignItems: 'center',
        columnGap: 1.5,
        rowGap: 1.25,
      }}
    >
      {children}
    </Box>
  );
}

interface IYfFieldRowProps {
  label: React.ReactNode;
  /** Nudge the label to the top, for a control taller than one line. */
  // eslint-disable-next-line react/require-default-props
  alignTop?: boolean;
  // eslint-disable-next-line react/require-default-props
  helpTopic?: HelpTopicId;
}

/** One label/control pair inside a `YfFieldGrid`. */
export function YfFieldRow(props: React.PropsWithChildren<IYfFieldRowProps>) {
  const { label, alignTop, helpTopic, children } = props;

  return (
    <>
      <Typography
        component="div"
        variant="body2"
        color="text.secondary"
        sx={{ alignSelf: alignTop ? 'start' : 'center', pt: alignTop ? '9px' : 0 }}
      >
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          {label}
          {helpTopic && <YfHelpPopover topic={helpTopic} label={helpLabelFor(label)} />}
        </Box>
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </>
  );
}

/**
 * A grid of on/off settings, two across at desktop widths.
 *
 * Five full-width switch rows in a column reads as a mobile form; paired up they read as a
 * configuration panel and take half the vertical space.
 */
export function YfToggleGrid(props: React.PropsWithChildren<unknown>) {
  const { children } = props;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
        columnGap: 4,
      }}
    >
      {children}
    </Box>
  );
}

interface IYfToggleRowProps {
  label: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  hint?: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  helpTopic?: HelpTopicId;
}

/** One switch row inside a `YfToggleGrid`. */
export function YfToggleRow(props: React.PropsWithChildren<IYfToggleRowProps>) {
  const { label, hint, helpTopic, children } = props;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        minHeight: 34,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography component="div" variant="body1" sx={{ lineHeight: 1.3 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            {label}
            {helpTopic && <YfHelpPopover topic={helpTopic} label={helpLabelFor(label)} />}
          </Box>
        </Typography>
        {hint && (
          <Typography component="div" variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0 }}>{children}</Box>
    </Box>
  );
}

interface IYfEmptyStateProps {
  /** What the situation is, stated plainly. */
  title: string;
  /** Why it's like that and/or what the user should do next. */
  // eslint-disable-next-line react/require-default-props
  description?: React.ReactNode;
  /** The single most useful next step, if there is one. */
  // eslint-disable-next-line react/require-default-props
  action?: React.ReactNode;
  /** Sit inside a panel that already has a border, so don't add vertical bulk. */
  // eslint-disable-next-line react/require-default-props
  compact?: boolean;
}

/**
 * What a panel says when it has nothing in it. Always names the state and, where one exists, offers
 * the next step — an empty panel that only says "None" makes the user guess whether something is
 * broken.
 */
export function YfEmptyState(props: IYfEmptyStateProps) {
  const { title, description, action, compact } = props;

  return (
    <Box sx={{ px: 3, py: compact ? 2.5 : 5, textAlign: 'center' }}>
      <Typography variant="subtitle2">{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mx: 'auto', maxWidth: '46ch' }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

interface IYfNoticeProps {
  /** Leading icon. Sized by the caller so it can match the notice's tone. */
  // eslint-disable-next-line react/require-default-props
  icon?: React.ReactNode;
  title: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  description?: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  action?: React.ReactNode;
  /** Tint the border and icon. Omit for a neutral "this is how things are" notice. */
  // eslint-disable-next-line react/require-default-props
  tone?: 'neutral' | 'warning' | 'error';
}

const noticeToneColor = {
  neutral: 'divider',
  warning: 'warning.main',
  error: 'error.main',
} as const;

/**
 * A standing statement about the state of the page — "these rules are locked", "the server is off".
 *
 * Distinct from `Alert` on purpose: alerts read as events that just happened and invite dismissal,
 * whereas these conditions persist and usually need explaining rather than acknowledging.
 */
export function YfNotice(props: IYfNoticeProps) {
  const { icon, title, description, action, tone = 'neutral' } = props;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
        px: 1.75,
        py: 1.25,
        border: 1,
        borderColor: noticeToneColor[tone],
        borderRadius: 1.25,
        backgroundColor: 'background.paper',
      }}
    >
      {icon && (
        <Box
          sx={{
            display: 'flex',
            flexShrink: 0,
            mt: '1px',
            color: tone === 'neutral' ? 'text.secondary' : noticeToneColor[tone],
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="subtitle2" component="div">
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action && (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {action}
        </Stack>
      )}
    </Box>
  );
}

interface IYfDisclosureRowProps {
  label: React.ReactNode;
  /** A one-line précis of what's inside, shown only while collapsed. */
  // eslint-disable-next-line react/require-default-props
  summary?: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  defaultExpanded?: boolean;
}

/**
 * A settings row that expands to reveal less-common controls.
 *
 * Replaces the older `CollapsibleArea` for anything living in a `SettingsList`: the whole row is the
 * hit target, and the collapsed state carries a summary so the user can tell whether it's worth
 * opening rather than having to open it to find out.
 */
export function YfDisclosureRow(props: React.PropsWithChildren<IYfDisclosureRowProps>) {
  const { label, summary, defaultExpanded, children } = props;
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

  return (
    <Box>
      <ButtonBase
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        sx={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.5,
          py: 1,
          textAlign: 'left',
          borderRadius: 1,
        }}
      >
        <Typography component="div" variant="body1" sx={{ lineHeight: 1.4 }}>
          {label}
        </Typography>
        {!expanded && summary && (
          <Typography component="div" variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
            {summary}
          </Typography>
        )}
        <ExpandMore
          fontSize="small"
          sx={{
            ml: 'auto',
            flexShrink: 0,
            color: 'text.secondary',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </ButtonBase>
      <Collapse in={expanded}>
        <Box sx={{ pb: 1 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

interface IAdvancedNumericRuleFieldProps {
  label: string;
  required: boolean;
  value: string;
  onChange: (val: string) => void;
  onBlur: (val: string) => void;
  disabled: boolean;
  minValue: number;
  maxValue: number;
  /** Targeted help for this rule. Divisors in particular are worth explaining in place. */
  // eslint-disable-next-line react/require-default-props
  helpTopic?: HelpTopicId;
}

/** A small numeric setting row used for advanced scoring rules like divisors. */
export function AdvancedNumericRuleField(props: IAdvancedNumericRuleFieldProps) {
  const { label, required, value, onChange, onBlur, disabled, minValue, maxValue, helpTopic } = props;
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!invalidInteger(value, minValue, maxValue)) setError(false);
  }, [value, minValue, maxValue]);

  const handleChange = (str: string) => {
    if (required && str === '') {
      setError(true);
    } else if (invalidInteger(str, minValue, maxValue)) {
      setError(true);
    } else {
      setError(false);
    }
    onChange(str);
  };

  return (
    <SettingRow label={label} helpTopic={helpTopic}>
      <YfNumericField
        hiddenLabel
        sx={{ width: '9ch' }}
        slotProps={{ htmlInput: { min: 0 } }}
        disabled={disabled}
        error={error}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => onBlur(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onBlur(value);
        }}
      />
    </SettingRow>
  );
}

/** A run of `SettingRow`s, separated by hairlines. */
export function SettingsList(props: React.PropsWithChildren<unknown>) {
  const { children } = props;
  return <Box sx={{ '& > * + *': { borderTop: 1, borderColor: 'divider' } }}>{children}</Box>;
}

interface ISettingRowProps {
  label: React.ReactNode;
  // eslint-disable-next-line react/require-default-props
  description?: React.ReactNode;
  /** The control, rendered right-aligned. */
  // eslint-disable-next-line react/require-default-props
  control?: React.ReactNode;
  /** Stack the control under the label instead of beside it (for wide fields). */
  // eslint-disable-next-line react/require-default-props
  stacked?: boolean;
  /** Targeted help for this one setting. Not a place for page-level help. */
  // eslint-disable-next-line react/require-default-props
  helpTopic?: HelpTopicId;
}

/**
 * One line in a settings panel: label (plus optional helper text) on the left, control on the
 * right. Wrap a run of them in `SettingsList` to get hairlines between rows.
 */
export function SettingRow(props: React.PropsWithChildren<ISettingRowProps>) {
  const { label, description, control, stacked, helpTopic, children } = props;
  const theControl = control ?? children;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: stacked ? 0.75 : 2,
        py: 1,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography component="div" variant="body1" sx={{ lineHeight: 1.4 }}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            {label}
            {helpTopic && <YfHelpPopover topic={helpTopic} label={helpLabelFor(label)} />}
          </Box>
        </Typography>
        {description && (
          <Typography component="div" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {description}
          </Typography>
        )}
      </Box>
      {theControl && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: stacked ? 'stretch' : 'flex-end',
            gap: 1,
            flexShrink: 0,
          }}
        >
          {theControl}
        </Box>
      )}
    </Box>
  );
}
