import { leagueSettings } from "../data/leagueSettings.js";
import { getRosterCount, getRosterNeeds } from "./draft.js";

const POSITION_WEIGHTS = {
  RB: 16,
  WR: 14,
  TE: 11,
  QB: 4,
  DEF: -45
};
const ELITE_ONESIE_RANK = 5;
const BACKUP_ONESIE_VALUE_GAP = 10;
const STACK_REACH_LIMIT = -14;
const STACK_SOFT_REACH_LIMIT = -8;
const PASS_FIRST_STACK_QBS = new Set([
  "Joe Burrow",
  "Matthew Stafford",
  "Tua Tagovailoa",
  "Dak Prescott",
  "Brock Purdy",
  "Jared Goff",
  "C.J. Stroud",
  "Jordan Love",
  "Justin Herbert",
  "Patrick Mahomes II"
]);

export function getAvailablePlayers(players, picks) {
  const draftedIds = new Set(picks.map((pick) => pick.player.id));
  return players.filter((player) => !draftedIds.has(player.id)).sort((a, b) => a.rank - b.rank);
}

export function recommendPlayers(players, picks, roster, currentPick, limit = 8, nextPick = null) {
  const available = getAvailablePlayers(players, picks);
  const needs = getRosterNeeds(roster);

  const ranked = available
    .map((player) => {
      const score = scorePlayer(player, roster, needs, currentPick, available, nextPick);
      return { ...player, score, reason: buildReason(player, roster, needs, currentPick, available, nextPick) };
    })
    .sort((a, b) => b.score - a.score);

  return limitBackupOnesies(ranked, roster).slice(0, limit);
}

function limitBackupOnesies(players, roster) {
  let backupQbs = 0;
  let backupTes = 0;

  return players.filter((player) => {
    if (player.position === "QB" && roster.QB.length > 0) {
      backupQbs += 1;
      return backupQbs <= 1;
    }

    if (player.position === "TE" && roster.TE.length > 0) {
      backupTes += 1;
      return backupTes <= 2;
    }

    return true;
  });
}

function scorePlayer(player, roster, needs, currentPick, available, nextPick) {
  const rankValue = Math.max(270 - player.rank * 2.2, 0);
  const tierValue = Math.max(13 - Number(player.tier), 0) * 9;
  const positionValue = POSITION_WEIGHTS[player.position] ?? 0;
  const starterNeed = getStarterNeed(player, needs) * 22;
  const flexNeed = ["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0 ? 10 : 0;
  const valueVsAdp = getAdpValueBonus(player, currentPick);
  const tierDrop = getTierDropBonus(player, available);
  const overfillPenalty = getOverfillPenalty(player, roster);
  const depthBalancePenalty = getDepthBalancePenalty(player, roster);
  const rosterUrgency = getRosterUrgencyBonus(player, roster, needs, currentPick);
  const onesieValueBonus = getBackupOnesieValueBonus(player, roster, currentPick);
  const stackBonus = getStackBonus(player, roster, currentPick);
  const returnRisk = getReturnRiskBonus(player, currentPick, nextPick);
  const pathBonus = getNextPickPathBonus(player, roster, needs, available, nextPick);
  const defenseTimingPenalty = player.position === "DEF" && currentPick < leagueSettings.teams * (leagueSettings.rosterSlots.QB + leagueSettings.rosterSlots.RB + leagueSettings.rosterSlots.WR + leagueSettings.rosterSlots.TE + leagueSettings.rosterSlots.FLEX) ? 70 : 0;
  const onesieTimingPenalty = getOnesieTimingPenalty(player, roster, needs, currentPick);

  return rankValue + tierValue + positionValue + starterNeed + flexNeed + valueVsAdp + tierDrop + rosterUrgency + onesieValueBonus + stackBonus + returnRisk + pathBonus - overfillPenalty - depthBalancePenalty - defenseTimingPenalty - onesieTimingPenalty;
}

function getAdpValueBonus(player, currentPick) {
  const adp = Number(player.adp);
  const maxUsefulAdp = leagueSettings.teams * leagueSettings.draftRounds + 12;

  if (!Number.isFinite(adp) || adp > maxUsefulAdp) return 0;

  const valueGap = currentPick - adp;
  if (valueGap <= 0) return Math.max(valueGap, -22) * 0.7;

  return Math.min(valueGap, 18) * 0.35;
}

function getReturnRiskBonus(player, currentPick, nextPick) {
  if (!nextPick || nextPick <= currentPick) return 0;
  if (player.position === "DEF") return 0;

  const adp = Number(player.adp);
  const maxUsefulAdp = leagueSettings.teams * leagueSettings.draftRounds + 12;
  if (!Number.isFinite(adp) || adp > maxUsefulAdp) return 0;

  const likelyGoneBy = nextPick + 1;
  if (adp > likelyGoneBy) return 0;

  const riskWindow = Math.max(nextPick - currentPick, 1);
  const urgency = Math.max(likelyGoneBy - adp, 0);
  const positionMultiplier = ["RB", "WR"].includes(player.position) ? 1.25 : 0.85;

  return Math.min(urgency / riskWindow, 1.2) * 16 * positionMultiplier;
}

function getStarterNeed(player, needs) {
  if (needs[player.position] > 0) return 1;
  if (["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0) return 0.5;
  return 0;
}

function getOverfillPenalty(player, roster) {
  if (player.position === "DEF" && roster.DEF.length) return 90;
  if (player.position === "QB" && roster.QB.length) return 40;
  if (player.position === "TE" && roster.TE.length && roster.FLEX.length) return 90;
  const positionCount = roster[player.position]?.length ?? 0;
  const slotLimit = leagueSettings.rosterSlots[player.position] ?? 0;
  if (positionCount >= slotLimit && player.position !== "WR") return 12;
  return 0;
}

function getDepthBalancePenalty(player, roster) {
  const rosterPlayers = getRosterPlayers(roster);
  const wrCount = rosterPlayers.filter((candidate) => candidate.position === "WR").length;
  const rbCount = rosterPlayers.filter((candidate) => candidate.position === "RB").length;

  if (player.position === "WR") {
    if (wrCount >= 7) return 44;
    if (wrCount >= 6 && rbCount <= 4) return 34;
    if (wrCount >= 6) return 22;
  }

  if (player.position === "RB") {
    if (rbCount >= 6) return 18;
    if (rbCount >= 5 && wrCount <= 4) return 12;
  }

  return 0;
}

function getOnesieTimingPenalty(player, roster, needs, currentPick) {
  if (!["QB", "TE"].includes(player.position)) return 0;
  if (roster[player.position].length === 0) return 0;

  const drafted = getRosterCount(roster);
  const remainingRosterPicks = Math.max(leagueSettings.draftRounds - drafted, 0);
  const requiredOpenSlots = needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF;
  const finalRoundsStarted = currentPick >= leagueSettings.teams * (leagueSettings.draftRounds - 2);
  const starter = roster[player.position][0];
  const hasEliteStarter = Number(starter?.positionalRank) <= ELITE_ONESIE_RANK;
  const valueGap = getAdpValueGap(player, currentPick);

  if (remainingRosterPicks <= requiredOpenSlots) return 260;
  if (hasEliteStarter && !finalRoundsStarted) return 260;
  if (hasEliteStarter) return 150;
  if (!finalRoundsStarted && (valueGap === null || valueGap < BACKUP_ONESIE_VALUE_GAP)) return 150;

  return 15;
}

function getBackupOnesieValueBonus(player, roster, currentPick) {
  if (!["QB", "TE"].includes(player.position)) return 0;
  if (roster[player.position].length === 0) return 0;

  const starter = roster[player.position][0];
  const hasEliteStarter = Number(starter?.positionalRank) <= ELITE_ONESIE_RANK;
  const valueGap = getAdpValueGap(player, currentPick);

  if (hasEliteStarter || valueGap === null || valueGap < BACKUP_ONESIE_VALUE_GAP) return 0;

  const cap = player.position === "TE" ? 20 : 18;
  const multiplier = player.position === "TE" ? 6 : 4;

  return Math.min(valueGap, cap) * multiplier;
}

function getRosterUrgencyBonus(player, roster, needs, currentPick) {
  const drafted = getRosterCount(roster);
  const totalRosterSlots = leagueSettings.draftRounds;
  const remainingRosterPicks = Math.max(totalRosterSlots - drafted, 0);
  const requiredOpenSlots = needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF;
  const fillsRequiredSlot = fillsRequiredRosterSlot(player, needs);

  if (!fillsRequiredSlot) {
    return remainingRosterPicks <= requiredOpenSlots ? -140 : 0;
  }

  let bonus = 0;
  if (remainingRosterPicks <= requiredOpenSlots) bonus += 220;
  if (remainingRosterPicks <= requiredOpenSlots + 1) bonus += 100;

  if (player.position === "DEF" && needs.DEF > 0) {
    if (remainingRosterPicks <= 3) bonus += 180;
    if (currentPick >= leagueSettings.teams * (leagueSettings.draftRounds - 2)) bonus += 120;
  }

  return bonus;
}

function fillsRequiredRosterSlot(player, needs) {
  if (needs[player.position] > 0) return true;
  return ["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0;
}

function getNextPickPathBonus(player, roster, needs, available, nextPick) {
  if (!nextPick || player.position === "DEF") return 0;
  if (!["RB", "WR", "TE", "QB"].includes(player.position)) return 0;
  if (!fillsRequiredRosterSlot(player, needs) && !["RB", "WR"].includes(player.position)) return 0;

  const nextSame = getLikelyAvailableAtPick(available, nextPick, player.id)
    .filter((candidate) => candidate.position === player.position)
    .sort((a, b) => a.rank - b.rank)[0];

  if (!nextSame) return ["RB", "WR"].includes(player.position) ? 34 : 18;

  const tierGap = Number(nextSame.tier) - Number(player.tier);
  const rankGap = nextSame.rank - player.rank;
  if (tierGap <= 0 && rankGap < 14) return 0;

  const positionMultiplier = player.position === "WR" ? 1.25 : player.position === "RB" ? 1.18 : 0.75;
  const needMultiplier = fillsRequiredRosterSlot(player, needs) ? 1 : 0.55;
  const tierComponent = Math.max(tierGap, 0) * 15;
  const rankComponent = Math.min(Math.max(rankGap, 0) / 3, 16);

  return Math.min((tierComponent + rankComponent) * positionMultiplier * needMultiplier, 46);
}

function getLikelyAvailableAtPick(available, targetPick, excludePlayerId) {
  return available.filter((player) => {
    if (player.id === excludePlayerId) return false;
    const adp = Number(player.adp);
    const maxUsefulAdp = leagueSettings.teams * leagueSettings.draftRounds + 12;
    if (!Number.isFinite(adp) || adp > maxUsefulAdp) return true;
    return adp > targetPick + 1;
  });
}

function getTierDropBonus(player, available) {
  const samePosition = available.filter((candidate) => candidate.position === player.position);
  const nextSameTier = samePosition.find((candidate) => candidate.rank > player.rank && candidate.tier === player.tier);
  const nextAny = samePosition.find((candidate) => candidate.rank > player.rank);
  if (!nextSameTier && nextAny && nextAny.tier > player.tier) return 8;
  return 0;
}

function buildReason(player, roster, needs, currentPick, available, nextPick) {
  const reasons = [];
  const stackFit = getStackFit(player, roster, currentPick);
  if (needs[player.position] > 0) reasons.push(`${player.position} starter need`);
  if (["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0 && needs[player.position] === 0) reasons.push("flex eligible");
  if (stackFit) reasons.push(`stack with ${stackFit.name}`);
  if (player.position === "WR") reasons.push("full PPR/3 WR format");
  if (getReturnRiskBonus(player, currentPick, nextPick) >= 8) reasons.push("unlikely to return");
  if (getNextPickPathBonus(player, roster, needs, available, nextPick) >= 12) reasons.push("next-pick tier drop");
  if (getDepthBalancePenalty(player, roster) >= 30) reasons.push("depth balance check");
  if (player.position === "QB" && roster.QB.length === 0) reasons.push("only if value falls");
  if (player.position === "QB" && roster.QB.length > 0) reasons.push("backup QB is low priority");
  if (player.position === "TE" && roster.TE.length > 0) reasons.push("backup TE is low priority");
  if (player.position === "DEF") reasons.push("usually last-round target");
  if (getRosterUrgencyBonus(player, roster, needs, currentPick) >= 180) reasons.push("required roster slot");
  if (getAdpValueBonus(player, currentPick) >= 2.8) reasons.push("value vs ADP");
  if (getAdpValueBonus(player, currentPick) <= -8) reasons.push("early vs ADP");
  if (getTierDropBonus(player, available) > 0) reasons.push("tier drop after this range");
  return reasons.slice(0, 3).join(" - ") || `Ranked #${player.rank} overall`;
}

function getAdpValueGap(player, currentPick) {
  const adp = Number(player.adp);
  const maxUsefulAdp = leagueSettings.teams * leagueSettings.draftRounds + 12;
  if (!Number.isFinite(adp) || adp > maxUsefulAdp) return null;
  return currentPick - adp;
}

export function getStackFit(player, roster, currentPick) {
  if (!["QB", "WR", "TE"].includes(player.position)) return null;

  const rosterPlayers = getRosterPlayers(roster);
  const valueGap = getAdpValueGap(player, currentPick);
  if (valueGap !== null && valueGap < STACK_REACH_LIMIT) return null;

  if (player.position === "QB") {
    if (!PASS_FIRST_STACK_QBS.has(player.name)) return null;
    return rosterPlayers
      .filter((candidate) => ["WR", "TE"].includes(candidate.position) && candidate.team === player.team)
      .sort((a, b) => a.rank - b.rank)[0] ?? null;
  }

  const matchingQb = rosterPlayers.find((candidate) => candidate.position === "QB" && candidate.team === player.team && PASS_FIRST_STACK_QBS.has(candidate.name));
  return matchingQb ?? null;
}

function getStackBonus(player, roster, currentPick) {
  const stackFit = getStackFit(player, roster, currentPick);
  if (!stackFit) return 0;

  const valueGap = getAdpValueGap(player, currentPick);
  const reachMultiplier = valueGap === null || valueGap >= STACK_SOFT_REACH_LIMIT ? 1 : 0.45;
  const anchorBonus = stackFit.rank <= 60 || player.rank <= 60 ? 8 : 0;
  const positionBonus = player.position === "QB" ? 24 : 18;

  return (positionBonus + anchorBonus) * reachMultiplier;
}

function getRosterPlayers(roster) {
  return Object.values(roster).flat();
}
