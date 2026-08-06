/** Lifecycle areas that the user navigates among. Corresponds with buttons in the nav bar. */
export enum ApplicationPages {
  Setup,
  Games,
  Control,
  Reports,
}

/** Configuration tasks inside Setup. */
export enum SetupPages {
  Tournament,
  Rules,
  Teams,
  Format,
}

/** Tournament-day operating surfaces inside Control. */
export enum ControlPages {
  Live,
  MatchPlan,
  Rooms,
  Display,
}

export enum StatReportPages {
  Standings,
  Individuals,
  Scoreboard,
  TeamDetails,
  PlayerDetails,
  RoundReport,
}

export const StatReportPageOrder = [
  StatReportPages.Standings,
  StatReportPages.Individuals,
  StatReportPages.Scoreboard,
  StatReportPages.TeamDetails,
  StatReportPages.PlayerDetails,
  StatReportPages.RoundReport,
];

export const StatReportFileNames = {
  [StatReportPages.Standings]: 'standings.html',
  [StatReportPages.Individuals]: 'individuals.html',
  [StatReportPages.Scoreboard]: 'games.html',
  [StatReportPages.TeamDetails]: 'teamdetail.html',
  [StatReportPages.PlayerDetails]: 'playerdetail.html',
  [StatReportPages.RoundReport]: 'rounds.html',
};
