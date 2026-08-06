import { TableContainer } from '@mui/material';
import React from 'react';

/** A full-bleed table surface for use inside an already bordered YfCard. */
export default function YfTablePanel(props: React.PropsWithChildren) {
  const { children } = props;
  return <TableContainer>{children}</TableContainer>;
}
