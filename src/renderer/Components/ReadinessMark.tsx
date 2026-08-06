import { Check, Remove, WarningAmber } from '@mui/icons-material';
import { SvgIconProps } from '@mui/material';
import { ReadinessStatus } from '../Services/ReadinessSemantics';

export default function ReadinessMark({ status, ...props }: { status: ReadinessStatus } & SvgIconProps) {
  if (status === 'verified') {
    // eslint-disable-next-line react/jsx-props-no-spreading
    return <Check color="success" fontSize="small" {...props} />;
  }
  if (status === 'problem') {
    // eslint-disable-next-line react/jsx-props-no-spreading
    return <WarningAmber color="warning" fontSize="small" {...props} />;
  }
  // eslint-disable-next-line react/jsx-props-no-spreading
  return <Remove color="disabled" fontSize="small" {...props} />;
}
