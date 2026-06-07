export const leagueSettings = {
  name: "Ward19",
  leagueId: "671549",
  teams: 12,
  draftRounds: 15,
  scoring: "Full PPR",
  draftType: "Offline snake draft",
  rosterSlots: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    DEF: 1,
    BENCH: 6,
    IR: 2
  },
  scoringNotes: [
    "1 point per reception",
    "4 point passing TD",
    "6 point rushing/receiving TD",
    "No kicker",
    "15 round draft",
    "6 bench spots"
  ]
};

export const teamNames = Array.from({ length: leagueSettings.teams }, (_, index) => `Team ${index + 1}`);
