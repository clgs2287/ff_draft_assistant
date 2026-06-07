import { leagueSettings } from "../data/leagueSettings.js";

export const TOTAL_ROUNDS = leagueSettings.draftRounds;

export function getPickInfo(overallPick, teamCount = leagueSettings.teams) {
  const round = Math.ceil(overallPick / teamCount);
  const pickInRound = ((overallPick - 1) % teamCount) + 1;
  const teamSlot = round % 2 === 1 ? pickInRound : teamCount - pickInRound + 1;
  return { overallPick, round, pickInRound, teamSlot };
}

export function getTotalPicks(teamCount = leagueSettings.teams) {
  return teamCount * TOTAL_ROUNDS;
}

export function getMyUpcomingPicks(currentPick, mySlot, teamCount = leagueSettings.teams) {
  if (!mySlot) return [];
  const totalPicks = getTotalPicks(teamCount);
  const picks = [];
  for (let pick = currentPick; pick <= totalPicks; pick += 1) {
    if (getPickInfo(pick, teamCount).teamSlot === mySlot) picks.push(pick);
    if (picks.length === 3) break;
  }
  return picks;
}

export function buildRoster(picks, teamSlot) {
  const roster = { QB: [], RB: [], WR: [], TE: [], FLEX: [], DEF: [], BENCH: [] };
  const teamPicks = picks.filter((pick) => pick.teamSlot === teamSlot);

  for (const pick of teamPicks) {
    const player = pick.player;
    if (player.position === "DEF") {
      placePlayer(roster, "DEF", player);
    } else if (player.position === "QB") {
      placePlayer(roster, "QB", player);
    } else if (player.position === "TE") {
      if (!placePlayer(roster, "TE", player)) placeFlexOrBench(roster, player);
    } else if (player.position === "RB") {
      if (!placePlayer(roster, "RB", player)) placeFlexOrBench(roster, player);
    } else if (player.position === "WR") {
      if (!placePlayer(roster, "WR", player)) placeFlexOrBench(roster, player);
    }
  }

  return roster;
}

function placePlayer(roster, slot, player) {
  if (roster[slot].length < leagueSettings.rosterSlots[slot]) {
    roster[slot].push(player);
    return true;
  }
  return false;
}

function placeFlexOrBench(roster, player) {
  if (["RB", "WR", "TE"].includes(player.position) && roster.FLEX.length < leagueSettings.rosterSlots.FLEX) {
    roster.FLEX.push(player);
    return;
  }
  roster.BENCH.push(player);
}

export function getRosterNeeds(roster) {
  const needs = {};
  for (const slot of ["QB", "RB", "WR", "TE", "DEF"]) {
    needs[slot] = Math.max(leagueSettings.rosterSlots[slot] - roster[slot].length, 0);
  }
  needs.FLEX = Math.max(leagueSettings.rosterSlots.FLEX - roster.FLEX.length, 0);
  needs.BENCH = Math.max(leagueSettings.rosterSlots.BENCH - roster.BENCH.length, 0);
  return needs;
}

export function getRosterCount(roster) {
  return Object.values(roster).reduce((sum, players) => sum + players.length, 0);
}
