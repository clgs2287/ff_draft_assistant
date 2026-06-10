import { leagueSettings } from "../data/leagueSettings.js";
import { getRosterCount, getRosterNeeds } from "./draft.js";

const POSITION_WEIGHTS = {
  RB: 16,
  WR: 14,
  TE: 11,
  QB: 4,
  DEF: -45
};
const STRATEGY_MODES = new Set(["balanced", "wr-heavy", "hero-rb", "elite-onesie", "value-only"]);
const ELITE_ONESIE_RANK = 5;
const BACKUP_ONESIE_VALUE_GAP = 10;
const EXTREME_BACKUP_ONESIE_VALUE_GAP = 22;
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

export function recommendPlayers(players, picks, roster, currentPick, limit = 8, nextPick = null, strategyMode = "balanced") {
  const available = getAvailablePlayers(players, picks);
  const needs = getRosterNeeds(roster);
  const mode = STRATEGY_MODES.has(strategyMode) ? strategyMode : "balanced";

  const ranked = available
    .map((player) => {
      const breakdown = getScoreBreakdown(player, roster, needs, currentPick, available, nextPick, mode);
      const score = breakdown.reduce((total, item) => total + item.value, 0);
      return { ...player, score, breakdown: getVisibleBreakdown(breakdown), reason: buildReason(player, roster, needs, currentPick, available, nextPick, mode) };
    })
    .sort((a, b) => b.score - a.score);

  return limitDefenseRecommendations(limitBackupOnesies(ranked, roster, needs, currentPick), needs, currentPick).slice(0, limit);
}

function limitDefenseRecommendations(players, needs, currentPick) {
  if (needs.DEF <= 0) return players.filter((player) => player.position !== "DEF");
  if (isFinalDraftRound(currentPick)) {
    const defenses = players.filter((player) => player.position === "DEF");
    return defenses.length ? defenses : players;
  }

  let defenseShown = 0;
  return players.filter((player) => {
    if (player.position !== "DEF") return true;
    defenseShown += 1;
    return defenseShown <= 1;
  });
}

function limitBackupOnesies(players, roster, needs, currentPick) {
  let backupQbs = 0;
  let backupTes = 0;

  return players.filter((player) => {
    if (player.position === "QB" && roster.QB.length > 0) {
      backupQbs += 1;
      return backupQbs <= 1 && isBackupQbWorthShowing(player, needs, currentPick);
    }

    if (player.position === "TE" && roster.TE.length > 0) {
      if (roster.TE.length >= 2) return false;
      backupTes += 1;
      return backupTes <= 1;
    }

    return true;
  });
}

function isBackupQbWorthShowing(player, needs, currentPick) {
  return false;
}

function scorePlayer(player, roster, needs, currentPick, available, nextPick, strategyMode = "balanced") {
  return getScoreBreakdown(player, roster, needs, currentPick, available, nextPick, strategyMode).reduce((total, item) => total + item.value, 0);
}

function getScoreBreakdown(player, roster, needs, currentPick, available, nextPick, strategyMode) {
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
  const strategy = getStrategyAdjustment(player, roster, needs, currentPick, strategyMode);

  return [
    { label: "Rank", value: rankValue },
    { label: "Tier", value: tierValue },
    { label: "Position", value: positionValue },
    { label: "Starter need", value: starterNeed },
    { label: "Flex", value: flexNeed },
    { label: "ADP value", value: valueVsAdp },
    { label: "Tier drop", value: tierDrop },
    { label: "Roster urgency", value: rosterUrgency },
    { label: "Backup value", value: onesieValueBonus },
    { label: "Stack", value: stackBonus },
    { label: "May not return", value: returnRisk },
    { label: "Next-pick drop", value: pathBonus },
    { label: "Strategy", value: strategy },
    { label: "Overfill", value: -overfillPenalty },
    { label: "Depth balance", value: -depthBalancePenalty },
    { label: "DEF timing", value: -defenseTimingPenalty },
    { label: "QB/TE timing", value: -onesieTimingPenalty }
  ];
}

function getVisibleBreakdown(breakdown) {
  const priority = new Set([
    "Starter need",
    "Flex",
    "ADP value",
    "Tier drop",
    "Roster urgency",
    "Backup value",
    "Stack",
    "May not return",
    "Next-pick drop",
    "Strategy",
    "Overfill",
    "Depth balance",
    "DEF timing",
    "QB/TE timing"
  ]);

  const meaningful = breakdown
    .filter((item) => Math.abs(item.value) >= 0.5 && priority.has(item.label))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 5);

  const core = breakdown
    .filter((item) => ["Rank", "Tier"].includes(item.label) && Math.abs(item.value) >= 0.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, Math.max(0, 4 - meaningful.length));

  return [...meaningful, ...core].map((item) => ({
    ...item,
    value: Math.round(item.value)
  }));
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
  if (player.position === "QB" && !finalRoundsStarted) return 280;
  if (player.position === "TE" && roster.TE.length >= 2) return 320;
  if (player.position === "TE" && !finalRoundsStarted && (valueGap === null || valueGap < EXTREME_BACKUP_ONESIE_VALUE_GAP)) return 180;
  if (hasEliteStarter && !finalRoundsStarted) return 280;
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

  const requiredGap = player.position === "TE" && roster.TE.length > 0 ? EXTREME_BACKUP_ONESIE_VALUE_GAP : BACKUP_ONESIE_VALUE_GAP;
  if (hasEliteStarter || valueGap === null || valueGap < requiredGap) return 0;

  const cap = player.position === "TE" ? 14 : 12;
  const multiplier = player.position === "TE" ? 3 : 2;

  return Math.min(valueGap, cap) * multiplier;
}

function getRosterUrgencyBonus(player, roster, needs, currentPick) {
  const drafted = getRosterCount(roster);
  const totalRosterSlots = leagueSettings.draftRounds;
  const remainingRosterPicks = Math.max(totalRosterSlots - drafted, 0);
  const requiredOpenSlots = needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF;
  const fillsRequiredSlot = fillsRequiredRosterSlot(player, needs);

  if (player.position === "DEF" && needs.DEF > 0) {
    if (isFinalDraftRound(currentPick)) return 420;
    if (getDraftRound(currentPick) >= leagueSettings.draftRounds - 1) return 70;
    return 0;
  }

  if (!fillsRequiredSlot) {
    return remainingRosterPicks <= requiredOpenSlots ? -140 : 0;
  }

  let bonus = 0;
  if (remainingRosterPicks <= requiredOpenSlots) bonus += 220;
  if (remainingRosterPicks <= requiredOpenSlots + 1) bonus += 100;

  return bonus;
}

function getDraftRound(currentPick) {
  return Math.max(1, Math.ceil(currentPick / leagueSettings.teams));
}

function isFinalDraftRound(currentPick) {
  return getDraftRound(currentPick) >= leagueSettings.draftRounds;
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

function getStrategyAdjustment(player, roster, needs, currentPick, strategyMode) {
  const drafted = getRosterCount(roster);
  const round = Math.max(1, Math.ceil(currentPick / leagueSettings.teams));
  const rosterPlayers = getRosterPlayers(roster);
  const rbCount = rosterPlayers.filter((candidate) => candidate.position === "RB").length;
  const wrCount = rosterPlayers.filter((candidate) => candidate.position === "WR").length;
  const valueGap = getAdpValueGap(player, currentPick);
  const isValue = valueGap !== null && valueGap >= 8;
  const isMajorValue = valueGap !== null && valueGap >= 14;
  const isReach = valueGap !== null && valueGap <= -8;

  if (strategyMode === "balanced") {
    if (["QB", "TE"].includes(player.position) && roster[player.position].length === 0) {
      if (player.position === "QB") {
        if (round <= 4 && (valueGap === null || valueGap < 20)) return Number(player.positionalRank) <= ELITE_ONESIE_RANK ? -42 : -54;
        if (round === 5 && !isMajorValue) return Number(player.positionalRank) <= ELITE_ONESIE_RANK ? -24 : -34;
      }
      if (player.position === "TE") {
        if (round <= 4 && !isMajorValue) return Number(player.positionalRank) <= ELITE_ONESIE_RANK ? -24 : -34;
        if (round === 5 && !isValue) return Number(player.positionalRank) <= ELITE_ONESIE_RANK ? -12 : -20;
      }
    }
    return 0;
  }

  if (strategyMode === "wr-heavy") {
    if (player.position === "WR" && wrCount < 6) return round <= 8 ? 14 : 7;
    if (player.position === "RB" && rbCount >= 3 && needs.RB <= 0 && needs.FLEX <= 0) return -10;
    return 0;
  }

  if (strategyMode === "hero-rb") {
    if (player.position === "RB" && rbCount === 0 && round <= 3) return 18;
    if (player.position === "RB" && rbCount >= 1 && round >= 3 && round <= 8 && !isMajorValue) return -22;
    if (player.position === "RB" && rbCount >= 2 && round <= 8 && !isMajorValue) return -32;
    if (player.position === "WR" && rbCount >= 1 && wrCount < 6 && round <= 8) return 20;
    if (player.position === "WR" && rbCount >= 1 && wrCount < 7) return 10;
    if (player.position === "RB" && rbCount < 4 && round >= 9) return 8;
    return 0;
  }

  if (strategyMode === "elite-onesie") {
    if (["QB", "TE"].includes(player.position) && roster[player.position].length === 0 && Number(player.positionalRank) <= ELITE_ONESIE_RANK && round <= 6) return 18;
    if (["QB", "TE"].includes(player.position) && roster[player.position].length === 0 && Number(player.positionalRank) > ELITE_ONESIE_RANK && round <= 9 && !isValue) return -10;
    return 0;
  }

  if (strategyMode === "value-only") {
    let adjustment = 0;
    if (isValue) adjustment += Math.min(valueGap, 18) * 1.2;
    if (isReach && drafted < leagueSettings.draftRounds - 2) adjustment += Math.max(valueGap, -18) * 1.15;
    if (player.position === "WR" && wrCount < 5 && round >= 7) adjustment += round >= 10 ? 28 : 18;
    if (player.position === "RB" && rbCount >= 6 && wrCount < 5 && round >= 7) adjustment -= 36;
    if (player.position === "RB" && rbCount >= 5 && wrCount < 5 && round >= 7 && !isMajorValue) adjustment -= 18;
    return adjustment;
  }

  return 0;
}

function buildReason(player, roster, needs, currentPick, available, nextPick, strategyMode = "balanced") {
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
  if (getStrategyAdjustment(player, roster, needs, currentPick, strategyMode) >= 8) reasons.push("strategy fit");
  if (getStrategyAdjustment(player, roster, needs, currentPick, strategyMode) <= -8) reasons.push("strategy penalty");
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
