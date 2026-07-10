export const LEAGUE_PROFILES = {
  ward19: {
    id: "ward19",
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
  },
  draftkingsBestBall: {
    id: "draftkingsBestBall",
    name: "DraftKings Best Ball",
    leagueId: "draftkings-best-ball",
    teams: 12,
    draftRounds: 20,
    scoring: "DraftKings Best Ball",
    draftType: "Best ball snake draft",
    rosterSlots: {
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      FLEX: 1,
      DEF: 0,
      BENCH: 12,
      IR: 0
    },
    scoringNotes: [
      "Best ball: highest scoring eligible lineup counts each week",
      "1 point per reception",
      "4 point passing TD, 6 point rushing/receiving TD",
      "DraftKings yardage bonuses: 300 passing, 100 rushing, 100 receiving",
      "20 round draft",
      "No kicker or defense"
    ]
  }
};

export let leagueSettings = LEAGUE_PROFILES.ward19;

export function setLeagueSettingsProfile(profileId) {
  leagueSettings = LEAGUE_PROFILES[profileId] ?? LEAGUE_PROFILES.ward19;
  return leagueSettings;
}

export function getLeagueProfileOptions() {
  return Object.values(LEAGUE_PROFILES).map((profile) => ({
    id: profile.id,
    name: profile.name,
    teams: profile.teams,
    scoring: profile.scoring,
    draftRounds: profile.draftRounds
  }));
}

export const teamNames = Array.from({ length: LEAGUE_PROFILES.ward19.teams }, (_, index) => `Team ${index + 1}`);
