import { Check, Remove, WarningAmber } from '@mui/icons-material';
import { SvgIconProps } from '@mui/material';
import { ReadinessStatus } from '../Services/ReadinessSemantics';

export default function ReadinessMark({ status, ...props }: { status: ReadinessStatus } & SvgIconProps) {
  if (status === 'verified') return <Check color="success" fontSize="small" {...props} />;
  if (status === 'problem') return <WarningAmber color="warning" fontSize="small" {...props} />;
  return <Remove color="disabled" fontSize="small" {...props} />;
}
