import { Box, Button, Paper } from '@mui/material';
import { useContext } from 'react';
import { FileDownload, Launch } from '@mui/icons-material';
import { YfCssClasses, YfPageHeader } from '../Utils/GeneralReactUtils';
import { statReportProtocol } from '../../SharedUtils';
import { StatReportFileNames, StatReportPages } from '../Enums';
import useSubscription from '../Utils/CustomHooks';
import { TournamentContext } from '../TournamentManager';

export default function StatReportPage() {
  const tournManager = useContext(TournamentContext);
  const [updateTime] = useSubscription(tournManager.inAppStatReportGenerated);
  const path = `${statReportProtocol}://${StatReportFileNames[StatReportPages.Standings]}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ flex: '0 0 auto' }}>
        <YfPageHeader
          title="Stat report"
          description="A live preview of the standings. Export it or open the full report in a browser."
          actions={
            <>
              <Button
                variant="outlined"
                startIcon={<Launch />}
                onClick={() => tournManager.launchStatReportInBrowserWindow()}
              >
                Open in browser
              </Button>
              <Button variant="contained" startIcon={<FileDownload />} onClick={() => tournManager.exportStatReports()}>
                Export report
              </Button>
            </>
          }
        />
      </Box>
      <Paper
        variant="outlined"
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          backgroundColor: 'background.paper',
        }}
      >
        <Box
          component="iframe"
          key={updateTime.toISOString()}
          src={path}
          className={YfCssClasses.StatReportIFrame}
          sx={{ border: 'none', p: 1.5, width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto' }}
          title="Stat Report"
        />
      </Paper>
    </Box>
  );
}
