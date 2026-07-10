export const playoffScheduleWeeks = {
  15: [
    ["SF", "LAC"],
    ["SEA", "PHI"],
    ["CHI", "BUF"],
    ["MIA", "GB"],
    ["IND", "TEN"],
    ["CLE", "NYG"],
    ["BAL", "PIT"],
    ["NO", "TB"],
    ["ATL", "WSH"],
    ["CIN", "CAR"],
    ["JAX", "HOU"],
    ["NYJ", "ARI"],
    ["DEN", "LV"],
    ["DAL", "LAR"],
    ["DET", "MIN"],
    ["NE", "KC"]
  ],
  16: [
    ["HOU", "PHI"],
    ["GB", "CHI"],
    ["BUF", "DEN"],
    ["LAR", "SEA"],
    ["TB", "ATL"],
    ["CIN", "IND"],
    ["WSH", "MIN"],
    ["CAR", "PIT"],
    ["LAC", "MIA"],
    ["ARI", "NO"],
    ["NE", "NYJ"],
    ["CLE", "BAL"],
    ["TEN", "LV"],
    ["SF", "KC"],
    ["JAX", "DAL"],
    ["NYG", "DET"]
  ],
  17: [
    ["BAL", "CIN"],
    ["DEN", "NE"],
    ["KC", "LAC"],
    ["LAR", "TB"],
    ["WSH", "JAX"],
    ["NO", "ATL"],
    ["IND", "CLE"],
    ["NYG", "DAL"],
    ["PIT", "TEN"],
    ["BUF", "MIA"],
    ["MIN", "NYJ"],
    ["SEA", "CAR"],
    ["LV", "ARI"],
    ["DET", "CHI"],
    ["PHI", "SF"],
    ["HOU", "GB"]
  ]
};

export function getPlayoffOpponent(team, week) {
  const matchup = playoffScheduleWeeks[week]?.find(([away, home]) => away === team || home === team);
  if (!matchup) return null;
  return matchup[0] === team ? matchup[1] : matchup[0];
}

export function getPlayoffCorrelationWeeks(teamA, teamB) {
  return Object.entries(playoffScheduleWeeks)
    .filter(([, games]) => games.some(([away, home]) => (
      (away === teamA && home === teamB) || (away === teamB && home === teamA)
    )))
    .map(([week]) => Number(week));
}
