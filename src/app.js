import { leagueSettings, teamNames as defaultTeamNames } from "./data/leagueSettings.js";
import { fantasyProsPlayers } from "./data/fantasyProsPlayers.js";
import { buildRoster, getMyUpcomingPicks, getPickInfo, getRosterCount, getRosterNeeds, getTotalPicks, TOTAL_ROUNDS } from "./logic/draft.js";
import { getAvailablePlayers, getStackFit, recommendPlayers } from "./logic/recommendations.js";

const STORAGE_KEY = "ward19-draft-assistant-state-v1";
const PLAYER_DATA_KEY = "ward19-draft-assistant-player-data-v1";
const APP_CACHE_VERSION = "ward19-draft-v54";
const DEFAULT_DRAFT_SHARKS_WEIGHT = 55;
const DEFAULT_FANTASYPROS_WEIGHT = 45;
const DEFAULT_CUSTOM_RANKING_WEIGHT = 30;
const BOARD_LIMIT = 220;
const TEAM_ROSTER_TEMPLATE = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "BN", "BN", "BN", "BN", "BN", "BN"];
const TEAM_CODES = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAC", "JAX", "KC", "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"
];
const STRATEGY_MODES = [
  { id: "balanced", label: "Balanced", detail: "Best overall build" },
  { id: "wr-heavy", label: "WR Heavy", detail: "Lean into PPR depth" },
  { id: "hero-rb", label: "Hero RB", detail: "One early RB, then WR" },
  { id: "elite-onesie", label: "Elite QB/TE", detail: "Push top QB or TE" },
  { id: "value-only", label: "Value Only", detail: "Respect ADP value" }
];
const TEAM_PROFILE_OPTIONS = {
  qb: [
    { id: "normal", label: "QB normal" },
    { id: "early", label: "QB early" },
    { id: "two-plus", label: "2+ QBs" }
  ],
  def: [
    { id: "normal", label: "DEF normal" },
    { id: "early", label: "DEF early" }
  ],
  position: [
    { id: "balanced", label: "Balanced" },
    { id: "rb", label: "RB lean" },
    { id: "wr", label: "WR lean" }
  ],
  reach: [
    { id: "conservative", label: "Conservative" },
    { id: "normal", label: "Normal" },
    { id: "chaotic", label: "Chaotic" }
  ]
};
const DEFAULT_TEAM_PROFILE = {
  qb: "two-plus",
  def: "normal",
  position: "balanced",
  reach: "normal"
};
const app = document.querySelector("#app");

let state = loadState();
let playerData = loadPlayerData();
let pendingRankingImport = null;

function defaultState() {
  return {
    mySlot: null,
    picks: [],
    search: "",
    editPickIndex: null,
    editSearch: "",
    teamNames: defaultTeamNames,
    teamProfiles: Array.from({ length: leagueSettings.teams }, () => ({ ...DEFAULT_TEAM_PROFILE })),
    teamSort: "roster",
    draftLabResult: null,
    liveFilter: "ALL",
    positionFilter: "ALL",
    strategyMode: "balanced",
    activeView: "draft"
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return normalizeState({ ...defaultState(), ...saved });
  } catch {
    return defaultState();
  }
}

function normalizeState(nextState) {
  const savedTeamNames = Array.isArray(nextState.teamNames) ? nextState.teamNames : [];
  const savedTeamProfiles = Array.isArray(nextState.teamProfiles) ? nextState.teamProfiles : [];
  const strategyMode = STRATEGY_MODES.some((mode) => mode.id === nextState.strategyMode) ? nextState.strategyMode : "balanced";
  return {
    ...nextState,
    strategyMode,
    teamNames: Array.from({ length: leagueSettings.teams }, (_, index) => {
      const name = String(savedTeamNames[index] ?? "").trim();
      return name || defaultTeamNames[index];
    }),
    teamProfiles: Array.from({ length: leagueSettings.teams }, (_, index) => normalizeTeamProfile(savedTeamProfiles[index]))
  };
}

function normalizeTeamProfile(profile = {}) {
  return {
    qb: isProfileOption("qb", profile.qb) ? profile.qb : DEFAULT_TEAM_PROFILE.qb,
    def: isProfileOption("def", profile.def) ? profile.def : DEFAULT_TEAM_PROFILE.def,
    position: isProfileOption("position", profile.position) ? profile.position : DEFAULT_TEAM_PROFILE.position,
    reach: isProfileOption("reach", profile.reach) ? profile.reach : DEFAULT_TEAM_PROFILE.reach
  };
}

function isProfileOption(group, value) {
  return TEAM_PROFILE_OPTIONS[group].some((option) => option.id === value);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadPlayerData() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_DATA_KEY) || "null");
    if (!saved || !Array.isArray(saved.players) || !saved.players.length) return null;
    return saved;
  } catch {
    return null;
  }
}

function savePlayerData(nextPlayerData) {
  playerData = nextPlayerData;
  if (playerData) {
    localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(playerData));
  } else {
    localStorage.removeItem(PLAYER_DATA_KEY);
  }
  render();
}

function getPlayerPool() {
  return playerData?.players?.length ? playerData.players : fantasyProsPlayers;
}

function setState(nextState) {
  state = normalizeState({ ...state, ...nextState });
  saveState();
  render();
}

function draftPlayer(playerId) {
  const player = getPlayerPool().find((candidate) => candidate.id === playerId);
  if (!player) return;
  const pickInfo = getPickInfo(state.picks.length + 1);
  const warnings = getDraftMistakeWarnings(player, pickInfo);
  if (warnings.length && !confirm(`Draft ${player.name} anyway?\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}`)) return;

  setState({
    picks: [...state.picks, { ...pickInfo, player }],
    search: "",
    editPickIndex: null,
    editSearch: ""
  });
}

function getDraftMistakeWarnings(player, pickInfo) {
  const roster = buildRoster(state.picks, pickInfo.teamSlot);
  const needs = getRosterNeeds(roster);
  const rosterPlayers = Object.values(roster).flat();
  const counts = getPositionCounts(rosterPlayers.map((candidate) => ({ player: candidate })));
  const drafted = getRosterCount(roster);
  const remainingRosterPicks = Math.max(leagueSettings.draftRounds - drafted, 0);
  const requiredOpenSlots = needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF;
  const round = pickInfo.round;
  const warnings = [];
  const valueGap = getValueGap(player, pickInfo.overallPick);

  if (valueGap !== null && valueGap <= -18) {
    warnings.push(`${Math.round(Math.abs(valueGap))} picks early by ADP.`);
  }

  if (player.position === "DEF" && needs.DEF <= 0) {
    warnings.push("This team already has a defense.");
  } else if (player.position === "DEF" && round < leagueSettings.draftRounds - 1) {
    warnings.push("Defense is usually a final-round pick.");
  }

  if (player.position === "QB" && roster.QB.length > 0 && round < 13) {
    const starter = roster.QB[0];
    const eliteStarter = Number(starter?.positionalRank) <= 5;
    warnings.push(eliteStarter ? `Backup QB is very low priority after drafting ${starter.name}.` : "Second QB is usually a late luxury pick.");
  }

  if (player.position === "TE" && roster.TE.length > 0 && round < 13) {
    const starter = roster.TE[0];
    const eliteStarter = Number(starter?.positionalRank) <= 5;
    warnings.push(eliteStarter ? `Backup TE is very low priority after drafting ${starter.name}.` : "Second TE is usually a late luxury pick.");
  }

  if (player.position === "WR" && counts.WR >= 7) {
    warnings.push("This would be an 8th WR.");
  }

  if (player.position === "RB" && counts.RB >= 6) {
    warnings.push("This would be a 7th RB.");
  }

  if (!fillsOpenRosterSlot(player, needs) && remainingRosterPicks <= requiredOpenSlots + 1) {
    warnings.push("Required roster slots are almost out of time.");
  }

  return warnings.slice(0, 3);
}

function fillsOpenRosterSlot(player, needs) {
  if (needs[player.position] > 0) return true;
  return ["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0;
}

function autoDraftNextPick() {
  const ctx = getCurrentContext();
  if (ctx.currentPick > ctx.totalPicks) return;
  if (state.mySlot && ctx.currentInfo.teamSlot === state.mySlot) return;

  const player = chooseMockPlayer(ctx.available, state.picks, ctx.currentInfo);
  if (!player) return;

  setState({
    picks: [...state.picks, { ...ctx.currentInfo, player, mocked: true }],
    search: ""
  });
}

function autoDraftToMyPick() {
  if (!state.mySlot) return;

  let picks = [...state.picks];
  const totalPicks = getTotalPicks();

  while (picks.length < totalPicks) {
    const currentPick = picks.length + 1;
    const pickInfo = getPickInfo(currentPick);
    if (pickInfo.teamSlot === state.mySlot) break;

    const available = getAvailablePlayers(getPlayerPool(), picks);
    const player = chooseMockPlayer(available, picks, pickInfo);
    if (!player) break;

    picks = [...picks, { ...pickInfo, player, mocked: true }];
  }

  setState({ picks, search: "" });
}

function undoPick() {
  setState({ picks: state.picks.slice(0, -1) });
}

function startEditPick(pickIndex) {
  if (!state.picks[pickIndex]) return;
  setState({ editPickIndex: pickIndex, editSearch: "" });
  requestAnimationFrame(() => {
    app.querySelector(".correction-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function cancelEditPick() {
  setState({ editPickIndex: null, editSearch: "" });
}

function replacePickPlayer(pickIndex, playerId) {
  const player = getPlayerPool().find((candidate) => candidate.id === playerId);
  if (!player || !state.picks[pickIndex]) return;

  const picks = state.picks.map((pick, index) => {
    if (index !== pickIndex) return pick;
    return { ...pick, player };
  });

  setState({
    picks: normalizePicks(picks),
    editPickIndex: null,
    editSearch: "",
    search: ""
  });
}

function deletePick(pickIndex) {
  const pick = state.picks[pickIndex];
  if (!pick) return;
  if (!confirm(`Delete pick ${pick.overallPick}: ${pick.player.name}?`)) return;

  setState({
    picks: normalizePicks(state.picks.filter((_, index) => index !== pickIndex)),
    editPickIndex: null,
    editSearch: ""
  });
}

function exportDraftHistory() {
  if (!state.picks.length) return;

  const payload = buildDraftHistoryExport();
  downloadJson(payload, `ward19-draft-history-${new Date().toISOString().slice(0, 10)}.json`);
}

function backupCurrentDraft() {
  const payload = {
    schemaVersion: 1,
    backupType: "ward19-current-draft-state",
    exportedAt: new Date().toISOString(),
    app: {
      name: "Ward19 Draft Assistant",
      cacheVersion: APP_CACHE_VERSION,
      storageKey: STORAGE_KEY
    },
    state: {
      ...state,
      editPickIndex: null,
      editSearch: "",
      search: ""
    },
    playerData
  };

  downloadJson(payload, `ward19-current-draft-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function restoreDraftBackup(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result || "{}"));
      if (payload.backupType !== "ward19-current-draft-state" || !payload.state) {
        alert("That file does not look like a Ward19 current draft backup.");
        return;
      }

      const pickCount = Array.isArray(payload.state.picks) ? payload.state.picks.length : 0;
      if (!confirm(`Restore backup with ${pickCount} pick${pickCount === 1 ? "" : "s"}? This replaces the current draft on this device.`)) return;

      state = normalizeState({ ...defaultState(), ...payload.state, editPickIndex: null, editSearch: "", search: "" });
      if (payload.playerData?.players?.length) {
        playerData = payload.playerData;
        localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(playerData));
      } else {
        playerData = null;
        localStorage.removeItem(PLAYER_DATA_KEY);
      }
      saveState();
      render();
    } catch {
      alert("Could not restore that backup file.");
    }
  });
  reader.readAsText(file);
}

function importFantasyProsRankings(file) {
  if (!file) return;

  readTextFile(file, (text) => {
    try {
      const rankingPlayers = loadFantasyProsPlayersFromCsv(text);
      if (!rankingPlayers.length) {
        alert("No usable players were found in that FantasyPros rankings CSV.");
        return;
      }

      const beatAdpRows = playerData?.beatAdpRows ?? [];
      const draftSharksRows = playerData?.draftSharksRows ?? [];
      const nextData = rebuildPlayerData({
        ...getPlayerDataMeta(),
        importedAt: new Date().toISOString(),
        rankingsFileName: file.name,
        rankingsImportedAt: new Date().toISOString(),
        rankingPlayers,
        beatAdpRows,
        draftSharksRows
      });
      savePlayerData(nextData);
      alert(`Imported ${nextData.players.length} ranked players${draftSharksRows.length ? `, matched ${nextData.matchedDraftSharks} Draft Sharks rows` : ""}${beatAdpRows.length ? `, and matched ${nextData.matchedBeatAdp} Beat ADP rows` : ""}.`);
    } catch {
      alert("Could not import that FantasyPros rankings CSV.");
    }
  });
}

function importBeatAdp(file) {
  if (!file) return;

  readTextFile(file, (text) => {
    try {
      const beatAdpRows = loadBeatAdpRowsFromCsv(text);
      if (!beatAdpRows.length) {
        alert("No usable Beat ADP rows were found in that CSV.");
        return;
      }

      const basePlayers = getBaseRankingPlayers();
      const draftSharksRows = playerData?.draftSharksRows ?? [];
      const nextData = rebuildPlayerData({
        ...getPlayerDataMeta(),
        importedAt: new Date().toISOString(),
        beatAdpFileName: file.name,
        beatAdpImportedAt: new Date().toISOString(),
        rankingPlayers: basePlayers,
        beatAdpRows,
        draftSharksRows
      });
      savePlayerData(nextData);
      alert(`Imported ${beatAdpRows.length} Beat ADP rows and matched ${nextData.matchedBeatAdp} players.`);
    } catch {
      alert("Could not import that Beat ADP CSV.");
    }
  });
}

function importDraftSharksRankings(file) {
  if (!file) return;

  readTextFile(file, (text) => {
    try {
      const draftSharksRows = loadDraftSharksRowsFromCsv(text);
      if (!draftSharksRows.length) {
        alert("No usable Draft Sharks rows were found in that CSV.");
        return;
      }

      const basePlayers = getBaseRankingPlayers();
      const beatAdpRows = playerData?.beatAdpRows ?? [];
      const nextData = rebuildPlayerData({
        ...getPlayerDataMeta(),
        importedAt: new Date().toISOString(),
        draftSharksFileName: file.name,
        draftSharksImportedAt: new Date().toISOString(),
        rankingPlayers: basePlayers,
        beatAdpRows,
        draftSharksRows
      });
      savePlayerData(nextData);
      alert(`Imported ${draftSharksRows.length} Draft Sharks rows and matched ${nextData.matchedDraftSharks} players.`);
    } catch {
      alert("Could not import that Draft Sharks CSV.");
    }
  });
}

function importGenericRankingSource(file) {
  if (!file) return;

  const defaultName = file.name.replace(/\.[^.]+$/g, "").replace(/[-_]+/g, " ").trim() || "Custom Rankings";
  const sourceName = prompt("Ranking source name?", defaultName);
  if (!sourceName) return;

  const weightInput = prompt("Source weight? Use 45 for FantasyPros-level, 55 for Draft Sharks-level, lower for weaker sources.", String(DEFAULT_CUSTOM_RANKING_WEIGHT));
  const weight = normalizeSourceWeight(weightInput, DEFAULT_CUSTOM_RANKING_WEIGHT);
  if (!weight) {
    alert("Weight must be a positive number.");
    return;
  }

  readTextFile(file, (text) => {
    try {
      const rows = loadGenericRankingRowsFromCsv(text, sourceName);
      if (!rows.length) {
        alert("No usable ranking rows were found. The CSV needs rank, player/name, team, and position columns.");
        return;
      }

      const sourceId = toSourceId(sourceName);
      const existingSources = getActiveRankingSources().filter((source) => source.id !== sourceId);
      const source = {
        id: sourceId,
        name: sourceName.trim(),
        fileName: file.name,
        importedAt: new Date().toISOString(),
        weight,
        rows
      };
      const rankingSources = [
        ...existingSources,
        source
      ];
      const nextData = rebuildPlayerData({
        ...getPlayerDataMeta(),
        importedAt: new Date().toISOString(),
        rankingPlayers: getBaseRankingPlayers(),
        beatAdpRows: playerData?.beatAdpRows ?? [],
        draftSharksRows: playerData?.draftSharksRows ?? [],
        rankingSources
      });
      pendingRankingImport = buildRankingImportPreview(source, nextData);
      render();
    } catch {
      alert("Could not import that ranking source CSV.");
    }
  });
}

function applyPendingRankingImport() {
  if (!pendingRankingImport) return;
  const applied = pendingRankingImport;
  pendingRankingImport = null;
  savePlayerData(applied.nextData);
  alert(`Imported ${applied.rowCount} ${applied.sourceName} rows and matched ${applied.matchCount} active players.`);
}

function cancelPendingRankingImport() {
  pendingRankingImport = null;
  render();
}

function buildRankingImportPreview(source, nextData) {
  const currentPlayers = getPlayerPool();
  const activeKeys = new Set(getBaseRankingPlayers().map((player) => playerKey(player.name, player.team)));
  const unmatched = source.rows
    .filter((row) => !activeKeys.has(playerKey(row.name, row.team)))
    .slice(0, 8)
    .map((row) => `${row.name} ${row.team} ${row.position}`);
  const matchCount = nextData.sourceMatches[source.id] ?? 0;
  const matchRate = source.rows.length ? matchCount / source.rows.length : 0;
  const warnings = [];

  if (matchRate < 0.5) warnings.push("Low match rate. Check that names, teams, and positions are in separate columns.");
  if (unmatched.length) warnings.push(`${unmatched.length} sample unmatched rows found.`);

  return {
    id: `${source.id}-${Date.now()}`,
    sourceId: source.id,
    sourceName: source.name,
    fileName: source.fileName,
    weight: source.weight,
    rowCount: source.rows.length,
    matchCount,
    unmatched,
    movers: getRankMovers(currentPlayers, nextData.players),
    warnings,
    nextData
  };
}

function getRankMovers(beforePlayers, afterPlayers) {
  const beforeByKey = new Map(beforePlayers.map((player) => [playerKey(player.name, player.team), player]));
  return afterPlayers
    .map((player) => {
      const before = beforeByKey.get(playerKey(player.name, player.team));
      if (!before) return null;
      const delta = before.rank - player.rank;
      if (!delta) return null;
      return {
        name: player.name,
        position: player.position,
        team: player.team,
        beforeRank: before.rank,
        afterRank: player.rank,
        delta
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.afterRank - b.afterRank)
    .slice(0, 8);
}

function updateRankingSourceWeight(sourceId, value) {
  if (!playerData) return;

  const weight = normalizeSourceWeight(value, null);
  if (!weight) return;

  const rankingSources = getActiveRankingSources().map((source) => (
    source.id === sourceId ? { ...source, weight } : source
  ));
  const nextData = rebuildPlayerData({
    ...getPlayerDataMeta(),
    importedAt: new Date().toISOString(),
    rankingPlayers: getBaseRankingPlayers(),
    beatAdpRows: playerData.beatAdpRows ?? [],
    draftSharksRows: playerData.draftSharksRows ?? [],
    rankingSources
  });
  savePlayerData(nextData);
}

function removeRankingSource(sourceId) {
  if (!playerData) return;
  const source = getActiveRankingSources().find((candidate) => candidate.id === sourceId);
  if (!source || ["fantasy-pros", "draft-sharks"].includes(source.id)) return;
  if (!confirm(`Remove ${source.name} from the blended rankings?`)) return;

  const rankingSources = getCustomRankingSources().filter((candidate) => candidate.id !== sourceId);
  const nextData = rebuildPlayerData({
    ...getPlayerDataMeta(),
    importedAt: new Date().toISOString(),
    rankingPlayers: getBaseRankingPlayers(),
    beatAdpRows: playerData.beatAdpRows ?? [],
    draftSharksRows: playerData.draftSharksRows ?? [],
    rankingSources
  });
  savePlayerData(nextData);
}

function getPlayerDataMeta() {
  return {
    rankingsFileName: playerData?.rankingsFileName ?? "Bundled FantasyPros rankings",
    rankingsImportedAt: playerData?.rankingsImportedAt ?? null,
    beatAdpFileName: playerData?.beatAdpFileName ?? null,
    beatAdpImportedAt: playerData?.beatAdpImportedAt ?? null,
    draftSharksFileName: playerData?.draftSharksFileName ?? null,
    draftSharksImportedAt: playerData?.draftSharksImportedAt ?? null
  };
}

function rebuildPlayerData(options) {
  const rankingPlayers = options.rankingPlayers?.length ? options.rankingPlayers.map(stripToBaseRankingPlayer) : fantasyProsPlayers.map(stripToBaseRankingPlayer);
  const beatAdpRows = options.beatAdpRows ?? [];
  const draftSharksRows = options.draftSharksRows ?? [];
  const rankingSources = normalizeRankingSources(options.rankingSources, rankingPlayers, draftSharksRows, options);
  const sourceMerge = mergePlayersWithRankingSources(rankingPlayers, rankingSources);
  const beatAdpMerge = mergePlayersWithBeatAdp(sourceMerge.players, beatAdpRows);

  return {
    schemaVersion: 2,
    importedAt: options.importedAt ?? new Date().toISOString(),
    rankingsFileName: options.rankingsFileName ?? "Bundled FantasyPros rankings",
    rankingsImportedAt: options.rankingsImportedAt ?? null,
    beatAdpFileName: options.beatAdpFileName ?? null,
    beatAdpImportedAt: options.beatAdpImportedAt ?? null,
    draftSharksFileName: options.draftSharksFileName ?? null,
    draftSharksImportedAt: options.draftSharksImportedAt ?? null,
    rankingCount: rankingPlayers.length,
    beatAdpCount: beatAdpRows.length,
    draftSharksCount: draftSharksRows.length,
    matchedBeatAdp: beatAdpMerge.matched,
    matchedDraftSharks: sourceMerge.sourceMatches["draft-sharks"] ?? 0,
    sourceMatches: sourceMerge.sourceMatches,
    rankingPlayers,
    beatAdpRows,
    draftSharksRows,
    rankingSources,
    players: beatAdpMerge.players
  };
}

function normalizeRankingSources(sources, rankingPlayers, draftSharksRows, meta = {}) {
  const existing = Array.isArray(sources) ? sources : getActiveRankingSources();
  const byId = new Map(existing.map((source) => [source.id, source]));
  const fantasyPros = byId.get("fantasy-pros");
  const draftSharks = byId.get("draft-sharks");
  const customSources = existing
    .filter((source) => !["fantasy-pros", "draft-sharks"].includes(source.id))
    .map(normalizeRankingSource)
    .filter(Boolean);

  return [
    {
      id: "fantasy-pros",
      name: "FantasyPros",
      fileName: meta.rankingsFileName ?? playerData?.rankingsFileName ?? "Bundled FantasyPros rankings",
      importedAt: meta.rankingsImportedAt ?? playerData?.rankingsImportedAt ?? null,
      weight: normalizeSourceWeight(fantasyPros?.weight, DEFAULT_FANTASYPROS_WEIGHT),
      rows: rankingPlayers.map((player) => ({
        name: player.name,
        team: player.team,
        position: player.position,
        sourceRank: player.fantasyProsRank ?? player.rank,
        bye: player.bye,
        tier: player.tier,
        adp: player.adp
      }))
    },
    ...(draftSharksRows.length ? [{
      id: "draft-sharks",
      name: "Draft Sharks",
      fileName: meta.draftSharksFileName ?? playerData?.draftSharksFileName ?? "Draft Sharks rankings",
      importedAt: meta.draftSharksImportedAt ?? playerData?.draftSharksImportedAt ?? null,
      weight: normalizeSourceWeight(draftSharks?.weight, DEFAULT_DRAFT_SHARKS_WEIGHT),
      rows: draftSharksRows.map((row) => ({
        ...row,
        sourceRank: row.draftSharksRank
      }))
    }] : []),
    ...customSources
  ];
}

function normalizeRankingSource(source) {
  if (!source?.id || !source?.name || !Array.isArray(source.rows)) return null;
  return {
    id: source.id,
    name: source.name,
    fileName: source.fileName ?? null,
    importedAt: source.importedAt ?? null,
    weight: normalizeSourceWeight(source.weight, DEFAULT_CUSTOM_RANKING_WEIGHT),
    rows: source.rows
      .map((row) => ({
        ...row,
        team: normalizeTeam(row.team),
        position: row.position === "DST" ? "DEF" : row.position,
        sourceRank: parseNumber(row.sourceRank ?? row.rank)
      }))
      .filter((row) => row.name && row.team && row.position && row.sourceRank)
  };
}

function getActiveRankingSources() {
  if (playerData?.rankingSources?.length) return playerData.rankingSources.map(normalizeRankingSource).filter(Boolean);

  const rankingPlayers = getBaseRankingPlayers();
  return normalizeRankingSources([], rankingPlayers, playerData?.draftSharksRows ?? [], getPlayerDataMeta());
}

function getCustomRankingSources() {
  return getActiveRankingSources().filter((source) => !["fantasy-pros", "draft-sharks"].includes(source.id));
}

function mergePlayersWithRankingSources(players, rankingSources) {
  const sourceMatches = {};
  const sourceMaps = rankingSources.map((source) => ({
    source,
    byKey: new Map(source.rows.map((row) => [playerKey(row.name, row.team), row]))
  }));

  const mergedPlayers = players.map((player) => {
    const base = stripToBaseRankingPlayer(player);
    const sourceRanks = {};
    let weightedRank = 0;
    let totalWeight = 0;
    let draftSharksFields = {};

    for (const { source, byKey } of sourceMaps) {
      const row = byKey.get(playerKey(base.name, base.team));
      if (!row) continue;

      const sourceRank = parseNumber(row.sourceRank ?? row.rank);
      const weight = normalizeSourceWeight(source.weight, 0);
      if (!sourceRank || !weight) continue;

      sourceMatches[source.id] = (sourceMatches[source.id] ?? 0) + 1;
      weightedRank += sourceRank * weight;
      totalWeight += weight;
      sourceRanks[source.id] = sourceRank;

      if (source.id === "draft-sharks") {
        draftSharksFields = {
          draftSharksRank: row.draftSharksRank,
          draftSharksAdp: row.draftSharksAdp,
          draftSharksGames: row.draftSharksGames,
          draftSharksBye: row.draftSharksBye,
          draftSharksSos: row.draftSharksSos,
          draftSharksInjuryRisk: row.draftSharksInjuryRisk,
          draftSharksFloor: row.draftSharksFloor,
          draftSharksConsensusProjection: row.draftSharksConsensusProjection,
          draftSharksProjection: row.draftSharksProjection,
          draftSharksCeiling: row.draftSharksCeiling,
          draftSharks3dValue: row.draftSharks3dValue
        };
      }
    }

    return {
      ...base,
      ...draftSharksFields,
      sourceRanks,
      sourceCount: Object.keys(sourceRanks).length,
      compositeRank: totalWeight ? weightedRank / totalWeight : base.rank
    };
  });

  return { players: applyCompositeRanks(mergedPlayers), sourceMatches };
}

function resetImportedPlayerData() {
  if (!playerData) return;
  if (!confirm("Reset imported rankings and ADP? The app will use the bundled player data again.")) return;
  savePlayerData(null);
}

function downloadJson(payload, fileName) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readTextFile(file, onLoad) {
  const reader = new FileReader();
  reader.addEventListener("load", () => onLoad(String(reader.result || "")));
  reader.addEventListener("error", () => alert("Could not read that file."));
  reader.readAsText(file);
}

function loadFantasyProsPlayersFromCsv(text) {
  return parseCsv(text)
    .slice(1)
    .map((cells) => {
      const rank = parseNumber(cells[0]);
      const tier = parseNumber(cells[1]);
      const name = String(cells[2] ?? "").trim();
      const team = normalizeTeam(cells[3]);
      const posText = String(cells[4] ?? "").trim();
      let position = posText.replace(/\d+$/g, "");
      if (position === "DST") position = "DEF";
      const positionalRank = parseNumber(posText.replace(/^\D+/g, ""));
      const bye = parseNumber(cells[5]);
      const ecrVsAdp = parseNumber(String(cells[9] ?? "").replace(/[^+\-0-9.]/g, "")) ?? 0;

      if (!rank || !name || !position || position === "K") return null;

      return {
        id: toPlayerId(name, position, team),
        name,
        position,
        team,
        bye,
        rank,
        positionalRank,
        tier,
        adp: Math.max(1, rank + ecrVsAdp),
        ecrVsAdp
      };
    })
    .filter(Boolean);
}

function loadBeatAdpRowsFromCsv(text) {
  return parseCsv(text)
    .slice(1)
    .map((cells) => {
      const rawPlayer = String(cells[1] ?? "").trim();
      const team = TEAM_CODES.find((code) => rawPlayer.endsWith(code));
      const name = team ? rawPlayer.slice(0, -team.length).trim() : rawPlayer;

      return {
        beatAdpRank: parseNumber(cells[0]),
        name,
        team: normalizeTeam(team),
        consensusAdp: parseNumber(cells[2]),
        sleeperAdp: parseNumber(cells[3]),
        espnAdp: parseNumber(cells[4]),
        yahooAdp: parseNumber(cells[5]),
        underdogAdp: parseNumber(cells[6]),
        fantasyProsAdp: parseNumber(cells[7])
      };
    })
    .filter((row) => row.name && row.team);
}

function loadDraftSharksRowsFromCsv(text) {
  return parseCsv(text)
    .slice(1)
    .map((cells) => {
      const rank = parseNumber(cells[0]);
      const team = normalizeTeam(cells[1]);
      const name = String(cells[2] ?? "").trim();
      const position = cells[3] === "DST" ? "DEF" : String(cells[3] ?? "").trim();

      if (!rank || !name || !position || position === "K") return null;

      return {
        draftSharksRank: rank,
        name,
        team,
        position,
        draftSharksGames: parseNumber(cells[4]),
        draftSharksAdp: parseNumber(cells[5]),
        draftSharksBye: parseNumber(cells[6]),
        draftSharksSos: parseNumber(String(cells[7] ?? "").replace("%", "")),
        draftSharksInjuryRisk: parseNumber(String(cells[8] ?? "").replace("%", "")),
        draftSharksFloor: parseNumber(cells[9]),
        draftSharksConsensusProjection: parseNumber(cells[10]),
        draftSharksProjection: parseNumber(cells[11]),
        draftSharksCeiling: parseNumber(cells[12]),
        draftSharks3dValue: parseNumber(cells[13])
      };
    })
    .filter(Boolean);
}

function loadGenericRankingRowsFromCsv(text, sourceName) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => normalizeHeader(header));
  const rankIndex = findHeaderIndex(headers, ["rank", "overall", "overallrank", "ovr", "ecr"]);
  const nameIndex = findHeaderIndex(headers, ["player", "playername", "name"]);
  const teamIndex = findHeaderIndex(headers, ["team", "nflteam", "tm"]);
  const positionIndex = findHeaderIndex(headers, ["pos", "position"]);
  const byeIndex = findHeaderIndex(headers, ["bye", "byeweek"]);
  const tierIndex = findHeaderIndex(headers, ["tier"]);
  const adpIndex = findHeaderIndex(headers, ["adp", "avgadp", "averageadp"]);

  if ([rankIndex, nameIndex, teamIndex, positionIndex].some((index) => index === -1)) return [];

  return rows
    .slice(1)
    .map((cells) => {
      const sourceRank = parseNumber(cells[rankIndex]);
      const name = String(cells[nameIndex] ?? "").trim();
      const team = normalizeTeam(cells[teamIndex]);
      let position = String(cells[positionIndex] ?? "").trim().replace(/\d+$/g, "");
      if (position === "DST") position = "DEF";
      if (!sourceRank || !name || !team || !position || position === "K") return null;

      return {
        sourceName,
        sourceRank,
        name,
        team,
        position,
        bye: byeIndex === -1 ? null : parseNumber(cells[byeIndex]),
        tier: tierIndex === -1 ? null : parseNumber(cells[tierIndex]),
        adp: adpIndex === -1 ? null : parseNumber(cells[adpIndex])
      };
    })
    .filter(Boolean);
}

function getBaseRankingPlayers() {
  if (playerData?.rankingPlayers?.length) return playerData.rankingPlayers;
  return fantasyProsPlayers.map(stripToBaseRankingPlayer);
}

function stripToBaseRankingPlayer(player) {
  const {
    draftSharksRank,
    draftSharksAdp,
    draftSharksGames,
    draftSharksBye,
    draftSharksSos,
    draftSharksInjuryRisk,
    draftSharksFloor,
    draftSharksConsensusProjection,
    draftSharksProjection,
    draftSharksCeiling,
    draftSharks3dValue,
    sourceRanks,
    sourceCount,
    ...base
  } = player;
  const rank = player.fantasyProsRank ?? player.rank;

  return {
    ...base,
    rank,
    fantasyProsRank: rank,
    compositeRank: rank
  };
}

function mergePlayersWithDraftSharks(players, draftSharksRows) {
  const draftSharksByKey = new Map(draftSharksRows.map((row) => [playerKey(row.name, row.team), row]));
  let matched = 0;
  const mergedPlayers = players.map((player) => {
    const fantasyProsRank = player.fantasyProsRank ?? player.rank;
    const draftSharks = draftSharksByKey.get(playerKey(player.name, player.team));
    if (!draftSharks) {
      return {
        ...stripToBaseRankingPlayer(player),
        fantasyProsRank,
        compositeRank: fantasyProsRank
      };
    }

    matched += 1;
    return {
      ...stripToBaseRankingPlayer(player),
      fantasyProsRank,
      compositeRank: ((draftSharks.draftSharksRank * DEFAULT_DRAFT_SHARKS_WEIGHT) + (fantasyProsRank * DEFAULT_FANTASYPROS_WEIGHT)) / (DEFAULT_DRAFT_SHARKS_WEIGHT + DEFAULT_FANTASYPROS_WEIGHT),
      draftSharksRank: draftSharks.draftSharksRank,
      draftSharksAdp: draftSharks.draftSharksAdp,
      draftSharksGames: draftSharks.draftSharksGames,
      draftSharksBye: draftSharks.draftSharksBye,
      draftSharksSos: draftSharks.draftSharksSos,
      draftSharksInjuryRisk: draftSharks.draftSharksInjuryRisk,
      draftSharksFloor: draftSharks.draftSharksFloor,
      draftSharksConsensusProjection: draftSharks.draftSharksConsensusProjection,
      draftSharksProjection: draftSharks.draftSharksProjection,
      draftSharksCeiling: draftSharks.draftSharksCeiling,
      draftSharks3dValue: draftSharks.draftSharks3dValue
    };
  });

  return { players: applyCompositeRanks(mergedPlayers), matched };
}

function mergePlayersWithBeatAdp(players, beatAdpRows) {
  const beatAdpByKey = new Map(beatAdpRows.map((row) => [playerKey(row.name, row.team), row]));
  let matched = 0;
  const mergedPlayers = players.map((player) => {
    const beatAdp = beatAdpByKey.get(playerKey(player.name, player.team));
    if (!beatAdp) return player;

    matched += 1;
    const preferredAdp =
      beatAdp.yahooAdp ??
      beatAdp.consensusAdp ??
      beatAdp.sleeperAdp ??
      beatAdp.espnAdp ??
      player.adp;

    return {
      ...player,
      adp: preferredAdp,
      beatAdpRank: beatAdp.beatAdpRank,
      consensusAdp: beatAdp.consensusAdp,
      sleeperAdp: beatAdp.sleeperAdp,
      espnAdp: beatAdp.espnAdp,
      yahooAdp: beatAdp.yahooAdp,
      underdogAdp: beatAdp.underdogAdp,
      fantasyProsAdp: beatAdp.fantasyProsAdp
    };
  });

  return { players: mergedPlayers, matched };
}

function applyCompositeRanks(players) {
  const positionCounts = {};
  return [...players]
    .sort((a, b) => (a.compositeRank ?? a.rank) - (b.compositeRank ?? b.rank))
    .map((player, index) => {
      positionCounts[player.position] = (positionCounts[player.position] ?? 0) + 1;
      return {
        ...player,
        rank: index + 1,
        positionalRank: positionCounts[player.position]
      };
    });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function parseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "\u2014") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeSourceWeight(value, fallback) {
  const weight = parseNumber(value);
  if (weight && weight > 0) return weight;
  return fallback;
}

function normalizeTeam(team) {
  const code = String(team ?? "").trim();
  if (code === "JAC") return "JAX";
  if (code === "LVR") return "LV";
  return code;
}

function nameKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/\b(ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function playerKey(name, team) {
  return `${nameKey(name)}|${normalizeTeam(team)}`;
}

function toPlayerId(name, position, team) {
  return `${name}-${position}-${team}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toSourceId(name) {
  const id = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return id ? `custom-${id}` : `custom-${Date.now()}`;
}

function resetDraft() {
  if (!confirm("Reset all draft picks?")) return;
  setState({ ...defaultState(), mySlot: state.mySlot, strategyMode: state.strategyMode, teamNames: state.teamNames, teamProfiles: state.teamProfiles, teamSort: state.teamSort });
}

function runDraftLab(mockCount = 100) {
  if (!state.mySlot) return;

  const runs = Array.from({ length: mockCount }, () => runSingleDraftLabMock());
  const result = summarizeDraftLabRuns(runs);
  setState({ draftLabResult: result, activeView: "lab" });
}

function runSingleDraftLabMock() {
  const players = getPlayerPool();
  let picks = [];
  const totalPicks = getTotalPicks();

  while (picks.length < totalPicks) {
    const currentPick = picks.length + 1;
    const pickInfo = getPickInfo(currentPick);
    const available = getAvailablePlayers(players, picks);
    const roster = state.mySlot ? buildRoster(picks, state.mySlot) : buildRoster([], 1);
    const upcoming = getMyUpcomingPicks(currentPick, state.mySlot);
    const nextTargetPick = getRecommendationTargetPick(currentPick, upcoming);
    const player = pickInfo.teamSlot === state.mySlot
      ? recommendPlayers(players, picks, roster, currentPick, 1, nextTargetPick, state.strategyMode)[0]
      : chooseMockPlayer(available, picks, pickInfo);

    if (!player) break;
    picks = [...picks, { ...pickInfo, player, mocked: pickInfo.teamSlot !== state.mySlot }];
  }

  const myPicks = picks.filter((pick) => pick.teamSlot === state.mySlot);
  const myRoster = buildRoster(picks, state.mySlot);
  const recap = getDraftRecap(myPicks, myRoster);
  const counts = getPositionCounts(myPicks);

  return { picks, myPicks, myRoster, recap, counts };
}

function summarizeDraftLabRuns(runs) {
  const gradeCounts = countBy(runs, (run) => run.recap.grade);
  const avgScore = average(runs.map((run) => run.recap.score));
  const rosterShapes = countBy(runs, (run) => `QB ${run.counts.QB}, RB ${run.counts.RB}, WR ${run.counts.WR}, TE ${run.counts.TE}, DEF ${run.counts.DEF}`);
  const firstFive = countBy(runs, (run) => run.myPicks.slice(0, 5).map((pick) => pick.player.name).join(" / "));
  const landedPlayers = countBy(runs.flatMap((run) => run.myPicks.filter((pick) => pick.player.position !== "DEF").map((pick) => pick.player.name)), (name) => name);
  const landedDefenses = countBy(runs.flatMap((run) => run.myPicks.filter((pick) => pick.player.position === "DEF").map((pick) => pick.player.name)), (name) => name);
  const thinFlags = {
    rbThin: runs.filter((run) => run.counts.RB < 4).length,
    wrThin: runs.filter((run) => run.counts.WR < 5).length,
    noQb: runs.filter((run) => run.counts.QB < 1).length,
    noTe: runs.filter((run) => run.counts.TE < 1).length,
    noDef: runs.filter((run) => run.counts.DEF < 1).length
  };

  return {
    createdAt: new Date().toISOString(),
    mockCount: runs.length,
    slot: state.mySlot,
    strategyMode: state.strategyMode,
    avgScore,
    gradeCounts,
    topRosterShapes: topCounts(rosterShapes, 4),
    topFirstFive: topCounts(firstFive, 4),
    topPlayers: topCounts(landedPlayers, 10),
    topDefenses: topCounts(landedDefenses, 4),
    qbTiming: getDraftLabQbTiming(runs),
    teTiming: getDraftLabTeTiming(runs),
    thinFlags
  };
}

function getDraftLabQbTiming(runs) {
  const firstQbs = runs
    .map((run) => run.myPicks.find((pick) => pick.player.position === "QB"))
    .filter(Boolean);
  const eliteQbRuns = runs.filter((run) => run.myPicks.some((pick) => pick.player.position === "QB" && Number(pick.player.positionalRank) <= 5));
  const nonEliteQbRuns = runs.filter((run) => !run.myPicks.some((pick) => pick.player.position === "QB" && Number(pick.player.positionalRank) <= 5));
  const joshAllenRuns = runs.filter((run) => run.myPicks.some((pick) => pick.player.name === "Josh Allen"));
  const roundCounts = countBy(firstQbs, (pick) => `Round ${pick.round}`);

  return {
    firstQbRounds: topCounts(roundCounts, 4),
    avgFirstQbRound: average(firstQbs.map((pick) => pick.round)),
    joshAllenCount: joshAllenRuns.length,
    eliteQbCount: eliteQbRuns.length,
    backupQbCount: runs.filter((run) => run.counts.QB >= 2).length,
    eliteImpact: getDraftLabBuildImpact(eliteQbRuns),
    nonEliteImpact: getDraftLabBuildImpact(nonEliteQbRuns)
  };
}

function getDraftLabTeTiming(runs) {
  const firstTes = runs
    .map((run) => run.myPicks.find((pick) => pick.player.position === "TE"))
    .filter(Boolean);
  const eliteTeRuns = runs.filter((run) => run.myPicks.some((pick) => pick.player.position === "TE" && Number(pick.player.positionalRank) <= 5));
  const multipleTeRuns = runs.filter((run) => run.counts.TE >= 2);
  const threeTeRuns = runs.filter((run) => run.counts.TE >= 3);
  const roundCounts = countBy(firstTes, (pick) => `Round ${pick.round}`);
  const frequentTes = countBy(runs.flatMap((run) => run.myPicks.filter((pick) => pick.player.position === "TE").map((pick) => pick.player.name)), (name) => name);

  return {
    firstTeRounds: topCounts(roundCounts, 4),
    avgFirstTeRound: average(firstTes.map((pick) => pick.round)),
    eliteTeCount: eliteTeRuns.length,
    backupTeCount: multipleTeRuns.length,
    threeTeCount: threeTeRuns.length,
    topTes: topCounts(frequentTes, 3),
    eliteImpact: getDraftLabBuildImpact(eliteTeRuns),
    nonEliteImpact: getDraftLabBuildImpact(runs.filter((run) => !eliteTeRuns.includes(run)))
  };
}

function getDraftLabBuildImpact(runs) {
  if (!runs.length) return null;
  return {
    avgScore: average(runs.map((run) => run.recap.score)),
    avgRb: average(runs.map((run) => run.counts.RB)),
    avgWr: average(runs.map((run) => run.counts.WR))
  };
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    if (!key) return counts;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function topCounts(counts, limit) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function getCurrentContext() {
  const currentPick = state.picks.length + 1;
  const totalPicks = getTotalPicks();
  const currentInfo = getPickInfo(Math.min(currentPick, totalPicks));
  const myRoster = state.mySlot ? buildRoster(state.picks, state.mySlot) : buildRoster([], 1);
  const upcoming = getMyUpcomingPicks(currentPick, state.mySlot);
  const nextTargetPick = getRecommendationTargetPick(currentPick, upcoming);
  const players = getPlayerPool();
  const recommendations = recommendPlayers(players, state.picks, myRoster, currentPick, 8, nextTargetPick, state.strategyMode);
  const available = getAvailablePlayers(players, state.picks);
  return { currentPick, totalPicks, currentInfo, myRoster, recommendations, available, upcoming };
}

function render() {
  const ctx = getCurrentContext();
  app.innerHTML = `
    <main class="shell">
      ${renderHeader(ctx)}
      ${state.activeView === "live" ? "" : renderSetup()}
      ${renderTabs()}
      <section class="view">
        ${state.activeView === "draft" ? renderDraftView(ctx) : ""}
        ${state.activeView === "live" ? renderDraftDayView(ctx) : ""}
        ${state.activeView === "available" ? renderAvailableView(ctx) : ""}
        ${state.activeView === "roster" ? renderRosterView(ctx) : ""}
        ${state.activeView === "plan" ? renderPlanView(ctx) : ""}
        ${state.activeView === "recap" ? renderRecapView(ctx) : ""}
        ${state.activeView === "lab" ? renderDraftLabView(ctx) : ""}
        ${state.activeView === "teams" ? renderTeamsView() : ""}
      </section>
    </main>
  `;
  bindEvents();
}

function renderHeader(ctx) {
  const nextPickText = state.mySlot && ctx.upcoming.length
    ? `Your next pick: ${ctx.upcoming[0] === ctx.currentPick ? "now" : `${ctx.upcoming[0] - ctx.currentPick} away`}`
    : "Set your draft slot";
  return `
    <header class="hero">
      <div>
        <p class="eyebrow">${leagueSettings.name} - ${leagueSettings.scoring}</p>
        <h1>Draft Assistant</h1>
      </div>
      <div class="pick-card">
        <span>Round ${ctx.currentInfo.round}</span>
        <strong>Pick ${Math.min(ctx.currentPick, ctx.totalPicks)}</strong>
        <small>${getTeamName(ctx.currentInfo.teamSlot)} - ${nextPickText}</small>
      </div>
    </header>
  `;
}

function getPlayerDataLabel() {
  return playerData ? "Imported data" : "Bundled data";
}

function getPlayerDataStatus() {
  if (!playerData) {
    return {
      label: "Bundled",
      title: `${fantasyProsPlayers.length} bundled players`,
      detail: "Import updated FantasyPros rankings or Beat ADP when you have fresh CSVs."
    };
  }

  const sourceCount = getActiveRankingSources().length;
  const rankings = `${sourceCount} ranking source${sourceCount === 1 ? "" : "s"}`;
  const draftSharks = playerData.draftSharksFileName ? `Draft Sharks: ${playerData.draftSharksFileName}` : "No imported Draft Sharks file";
  const adp = playerData.beatAdpFileName ? `ADP: ${playerData.beatAdpFileName}` : "No imported ADP file";
  const matched = Number(playerData.matchedBeatAdp ?? 0);
  const draftSharksMatched = Number(playerData.matchedDraftSharks ?? 0);
  return {
    label: "Imported",
    title: `${playerData.players.length} active players`,
    detail: `${rankings}. ${draftSharks}. ${draftSharksMatched} Draft Sharks matches. ${adp}. ${matched} ADP matches.`
  };
}

function renderSetup() {
  const activeStrategy = getActiveStrategyMode();
  return `
    <section class="setup">
      <div>
        <span class="label">Your Draft Slot</span>
        <div class="slot-grid">
          ${Array.from({ length: leagueSettings.teams }, (_, index) => {
            const slot = index + 1;
            return `<button class="slot-button ${state.mySlot === slot ? "selected" : ""}" data-slot="${slot}">${slot}</button>`;
          }).join("")}
        </div>
      </div>
      <div class="league-chip">${leagueSettings.teams} teams - ${TOTAL_ROUNDS} rounds - No K - ${getPlayerDataLabel()}</div>
      <div class="strategy-control">
        <div>
          <span class="label">Draft Strategy</span>
          <strong>${activeStrategy.label}</strong>
          <em>${activeStrategy.detail}</em>
        </div>
        <div class="strategy-grid">
          ${STRATEGY_MODES.map((mode) => `<button class="${state.strategyMode === mode.id ? "active" : ""}" data-strategy="${mode.id}">${mode.label}</button>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function getActiveStrategyMode() {
  return STRATEGY_MODES.find((mode) => mode.id === state.strategyMode) ?? STRATEGY_MODES[0];
}

function renderTabs() {
  const tabs = [
    ["draft", "Draft"],
    ["live", "Live"],
    ["available", "Available"],
    ["roster", "Roster"],
    ["plan", "Plan"],
    ["recap", "Recap"],
    ["lab", "Lab"],
    ["teams", "Teams"]
  ];
  return `
    <nav class="tabs">
      ${tabs.map(([id, label]) => `<button class="${state.activeView === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}
    </nav>
  `;
}

function renderDraftView(ctx) {
  return `
    <div class="action-row">
      <button class="secondary" data-action="undo" ${state.picks.length ? "" : "disabled"}>Undo</button>
      <button class="danger" data-action="reset">Reset</button>
    </div>
    ${renderMockControls(ctx)}
    ${renderLiveEntry(ctx)}
    ${renderDraftPulse(ctx)}
    ${renderRecommendations(ctx)}
    ${renderLikelyGone(ctx)}
    ${renderRecentPicks()}
    ${renderCorrectionPanel(ctx)}
  `;
}

function renderDraftDayView(ctx) {
  const positions = ["ALL", "QB", "RB", "WR", "TE", "DEF"];
  const query = state.search.trim().toLowerCase();
  const source = query ? ctx.available : getFocusedBoard(ctx.available);
  const players = source
    .filter((player) => state.liveFilter === "ALL" || player.position === state.liveFilter)
    .filter((player) => !query || `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(query))
    .slice(0, 12);
  const lastPick = state.picks[state.picks.length - 1];
  const bestPick = ctx.recommendations[0];
  const isMyPick = state.mySlot && ctx.currentInfo.teamSlot === state.mySlot;
  const canMockNext = ctx.currentPick <= ctx.totalPicks && (!state.mySlot || !isMyPick);
  const canMockToMe = state.mySlot && ctx.currentPick <= ctx.totalPicks && !isMyPick;

  return `
    <section class="draft-day">
      <div class="draft-day-clock ${isMyPick ? "mine" : ""}">
        <div>
          <span class="label">On The Clock</span>
          <strong>Round ${ctx.currentInfo.round}, Pick ${ctx.currentInfo.pickInRound}</strong>
          <em>${getTeamName(ctx.currentInfo.teamSlot)}</em>
        </div>
        <div class="draft-day-pick">
          <span>${isMyPick ? "You are up" : getLivePickDistanceText(ctx)}</span>
          <strong>${Math.min(ctx.currentPick, ctx.totalPicks)}</strong>
          <em>Overall</em>
        </div>
      </div>

      <div class="draft-day-actions">
        <button class="secondary" data-action="undo" ${state.picks.length ? "" : "disabled"}>Undo Last</button>
        <button class="secondary" data-action="mock-next" ${canMockNext ? "" : "disabled"}>Auto Next</button>
        <button class="primary-lite" data-action="mock-to-me" ${canMockToMe ? "" : "disabled"}>To My Pick</button>
      </div>

      ${bestPick ? `
        <section class="panel draft-day-best">
          <span class="label">Top Recommendation</span>
          <strong>${bestPick.name}</strong>
          <em>${bestPick.position} - ${bestPick.team} - ${formatScore(bestPick.score)} - ADP ${formatAdp(bestPick.adp)}</em>
          <div class="reason-list compact-reasons">
            ${getBestPickExplanation(bestPick, ctx).slice(0, 3).map((reason) => `<span>${reason}</span>`).join("")}
          </div>
        </section>
      ` : ""}

      <section class="panel draft-day-entry panel-accent accent-enter">
        <div class="panel-heading">
          <h2>Enter Pick</h2>
          <span>${players.length} shown</span>
        </div>
        <input class="search live-search draft-day-search" data-input="search" value="${escapeHtml(state.search)}" placeholder="Search player, team, or position" autocomplete="off" />
        <div class="filter-row live-filters">
          ${positions.map((position) => `<button class="${state.liveFilter === position ? "active" : ""}" data-live-filter="${position}">${position}</button>`).join("")}
        </div>
        <div class="player-list compact draft-day-results">
          ${players.length ? players.map((player) => renderPlayerRow(player, "Draft", true, ctx.currentPick)).join("") : "<p class='empty'>No matching available players.</p>"}
        </div>
      </section>

      <section class="panel draft-day-footer">
        <div>
          <span class="label">Last Pick</span>
          <strong>${lastPick ? `${lastPick.overallPick}. ${lastPick.player.name}` : "None yet"}</strong>
          <em>${lastPick ? `${lastPick.player.position} - ${getTeamName(lastPick.teamSlot)}${lastPick.mocked ? " - mocked" : ""}` : "Ready for pick 1."}</em>
        </div>
        <div>
          <span class="label">Your Slot</span>
          <strong>${state.mySlot ? state.mySlot : "Not set"}</strong>
          <em>${state.mySlot ? getLivePickDistanceText(ctx) : "Set slot from Draft tab"}</em>
        </div>
      </section>
    </section>
  `;
}

function getLivePickDistanceText(ctx) {
  if (!state.mySlot) return "Set slot";
  if (ctx.upcoming[0] === ctx.currentPick) return "Now";
  if (!ctx.upcoming.length) return "Done";
  const distance = ctx.upcoming[0] - ctx.currentPick;
  return distance === 1 ? "1 pick away" : `${distance} picks away`;
}

function renderMockControls(ctx) {
  const isMyPick = state.mySlot && ctx.currentInfo.teamSlot === state.mySlot;
  const canMockNext = ctx.currentPick <= ctx.totalPicks && (!state.mySlot || !isMyPick);
  const canMockToMe = state.mySlot && ctx.currentPick <= ctx.totalPicks && !isMyPick;
  const status = state.mySlot
    ? isMyPick
      ? "Your pick is up"
      : `Mock opponents until slot ${state.mySlot}`
    : "Set slot for fast-forward";

  return `
    <section class="panel mock-panel">
      <div class="panel-heading">
        <h2>Mock Draft</h2>
        <span>${status}</span>
      </div>
      <div class="mock-actions">
        <button class="secondary" data-action="mock-next" ${canMockNext ? "" : "disabled"}>Auto Next</button>
        <button class="primary-lite" data-action="mock-to-me" ${canMockToMe ? "" : "disabled"}>To My Pick</button>
      </div>
    </section>
  `;
}

function renderDraftPulse(ctx) {
  const bestPick = ctx.recommendations[0];
  const runAlert = getPositionRunAlert(state.picks);
  const rosterWarnings = getRosterWarnings(ctx);
  const explanation = bestPick ? getBestPickExplanation(bestPick, ctx) : [];

  return `
    <section class="panel pulse-panel panel-accent accent-pulse">
      <div class="panel-heading">
        <h2>Draft Pulse</h2>
        <span>${bestPick ? `Lean ${bestPick.position}` : "No board"}</span>
      </div>
      ${bestPick ? `
        <div class="pulse-best">
          <span class="label">Best Pick</span>
          <strong>${bestPick.name}</strong>
          <em>${bestPick.position} - ${bestPick.team} - Rank ${bestPick.rank} - ADP ${formatAdp(bestPick.adp)}</em>
        </div>
        <div class="reason-list">
          ${explanation.map((reason) => `<span>${reason}</span>`).join("")}
        </div>
      ` : "<p class='empty'>No players available.</p>"}
      <div class="alert-list">
        ${runAlert ? `<div class="alert-item warning"><strong>${runAlert.title}</strong><span>${runAlert.detail}</span></div>` : ""}
        ${rosterWarnings.map((warning) => `<div class="alert-item ${warning.level}"><strong>${warning.title}</strong><span>${warning.detail}</span></div>`).join("")}
        ${!runAlert && rosterWarnings.length === 0 ? "<div class='alert-item calm'><strong>Roster shape is fine</strong><span>No urgent position pressure yet.</span></div>" : ""}
      </div>
    </section>
  `;
}

function renderRecommendations(ctx) {
  return `
    <section class="panel panel-accent accent-recommended">
      <div class="panel-heading">
        <h2>Recommended</h2>
        <span>${state.mySlot ? "For your roster" : "Set slot to personalize"}</span>
      </div>
      <div class="player-list">
        ${ctx.recommendations.slice(0, 5).map((player, index) => renderPlayerRow(player, index === 0 ? `Best pick - ${formatScore(player.score)}` : `${formatScore(player.score)} - ${player.reason}`, true, ctx.currentPick)).join("")}
      </div>
    </section>
  `;
}

function renderLiveEntry(ctx) {
  const positions = ["ALL", "QB", "RB", "WR", "TE", "DEF"];
  const query = state.search.trim().toLowerCase();
  const source = query ? ctx.available : getFocusedBoard(ctx.available);
  const players = source
    .filter((player) => state.liveFilter === "ALL" || player.position === state.liveFilter)
    .filter((player) => !query || `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(query))
    .slice(0, 8);
  const lastPick = state.picks[state.picks.length - 1];

  return `
    <section class="panel live-panel panel-accent accent-enter">
      <div class="panel-heading">
        <h2>Live Entry</h2>
        <span>Pick ${Math.min(ctx.currentPick, ctx.totalPicks)} - ${getTeamName(ctx.currentInfo.teamSlot)}</span>
      </div>
      <div class="live-status">
        <div>
          <span class="label">On The Clock</span>
          <strong>Round ${ctx.currentInfo.round}, Pick ${ctx.currentInfo.pickInRound}</strong>
          <em>${state.mySlot && ctx.currentInfo.teamSlot === state.mySlot ? "Your pick" : getTeamName(ctx.currentInfo.teamSlot)}</em>
        </div>
        <button class="secondary" data-action="undo" ${state.picks.length ? "" : "disabled"}>Undo Last</button>
      </div>
      <input class="search live-search" data-input="search" value="${escapeHtml(state.search)}" placeholder="Type player name, team, or position" autocomplete="off" />
      <div class="filter-row live-filters">
        ${positions.map((position) => `<button class="${state.liveFilter === position ? "active" : ""}" data-live-filter="${position}">${position}</button>`).join("")}
      </div>
      <div class="player-list compact live-results">
        ${players.length ? players.map((player) => renderPlayerRow(player, "Draft", true, ctx.currentPick)).join("") : "<p class='empty'>No matching available players.</p>"}
      </div>
      <div class="live-last">
        <span>Last Pick</span>
        <strong>${lastPick ? `${lastPick.overallPick}. ${lastPick.player.name}` : "None yet"}</strong>
        <em>${lastPick ? `${lastPick.player.position} - ${getTeamName(lastPick.teamSlot)}${lastPick.mocked ? " - mocked" : ""}` : "Draft board is clean."}</em>
      </div>
    </section>
  `;
}

function renderLikelyGone(ctx) {
  if (!state.mySlot) {
    return `
      <section class="panel panel-accent accent-likely">
        <div class="panel-heading">
          <h2>Next Pick Watch</h2>
          <span>Set your slot</span>
        </div>
        <p class="empty">Choose your draft slot to see players who may not make it back to you.</p>
      </section>
    `;
  }

  const targetPick = ctx.upcoming[0] === ctx.currentPick ? ctx.upcoming[1] : ctx.upcoming[0];
  if (!targetPick) {
    return `
      <section class="panel panel-accent accent-likely">
        <div class="panel-heading">
          <h2>Next Pick Watch</h2>
          <span>End game</span>
        </div>
        <p class="empty">No future picks left after this one.</p>
      </section>
    `;
  }

  const riskWindow = targetPick - ctx.currentPick;
  const likelyGone = ctx.available
    .filter((player) => isLikelyGoneBefore(player, targetPick))
    .slice(0, 6);

  return `
    <section class="panel panel-accent accent-likely">
      <div class="panel-heading">
        <h2>Likely Gone</h2>
        <span>Before pick ${targetPick} (${riskWindow} away)</span>
      </div>
      <div class="player-list">
        ${likelyGone.length ? likelyGone.map((player) => renderPlayerRow(player, "May not return", true, ctx.currentPick)).join("") : "<p class='empty'>No obvious ADP danger before your next pick.</p>"}
      </div>
    </section>
  `;
}

function renderSearch(ctx) {
  const query = state.search.trim().toLowerCase();
  const source = query ? ctx.available : getFocusedBoard(ctx.available);
  const players = source
    .filter((player) => !query || `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(query))
    .slice(0, 14);
  const countLabel = query ? `${source.length} searchable` : `${source.length} on board`;

  return `
    <section class="panel panel-accent accent-enter">
      <div class="panel-heading">
        <h2>Enter Pick</h2>
        <span>${countLabel}</span>
      </div>
      <input class="search" data-input="search" value="${escapeHtml(state.search)}" placeholder="Search player, team, or position" autocomplete="off" />
      <div class="player-list compact">
        ${players.map((player) => renderPlayerRow(player, "Tap to draft", true, ctx.currentPick)).join("")}
      </div>
    </section>
  `;
}

function renderAvailableView(ctx) {
  const positions = ["ALL", "QB", "RB", "WR", "TE", "DEF"];
  const players = getFocusedBoard(ctx.available)
    .filter((player) => state.positionFilter === "ALL" || player.position === state.positionFilter)
    .slice(0, 40);
  return `
    <section class="panel">
      <div class="filter-row">
        ${positions.map((position) => `<button class="${state.positionFilter === position ? "active" : ""}" data-filter="${position}">${position}</button>`).join("")}
      </div>
      <div class="player-list">
        ${players.map((player) => renderPlayerRow(player, "Tap to draft", true, ctx.currentPick)).join("")}
      </div>
    </section>
  `;
}

function renderRosterView(ctx) {
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>My Roster</h2>
        <span>${state.mySlot ? `Slot ${state.mySlot}` : "No slot set"}</span>
      </div>
      ${Object.entries(ctx.myRoster).map(([slot, players]) => renderRosterSlot(slot, players)).join("")}
    </section>
  `;
}

function renderPlanView(ctx) {
  const plan = getDraftPlan(ctx);

  return `
    <section class="panel plan-panel">
      <div class="panel-heading">
        <h2>Draft Plan</h2>
        <span>Round ${ctx.currentInfo.round}</span>
      </div>
      <div class="plan-hero">
        <span class="label">Current Lean</span>
        <strong>${plan.currentLean}</strong>
        <em>${plan.summary}</em>
      </div>
      <div class="plan-grid">
        ${renderPlanBlock("Now", plan.now)}
        ${renderPlanBlock("Next Rounds", plan.rounds)}
        ${renderPlanBlock("Roster Targets", plan.targets)}
        ${renderPlanBlock("Guardrails", plan.guardrails)}
      </div>
    </section>
  `;
}

function renderPlanBlock(title, items) {
  return `
    <article class="plan-block">
      <h3>${title}</h3>
      ${items.map((item) => `<p><strong>${item.title}</strong><span>${item.detail}</span></p>`).join("")}
    </article>
  `;
}

function renderRecapView(ctx) {
  if (!state.mySlot) {
    return `
      <section class="panel">
        <div class="panel-heading">
          <h2>Mock Recap</h2>
          <span>Set your slot</span>
        </div>
        <p class="empty">Choose your draft slot and run a mock to grade your roster shape.</p>
      </section>
    `;
  }

  const myPicks = state.picks.filter((pick) => pick.teamSlot === state.mySlot);
  if (!myPicks.length) {
    return `
      <section class="panel">
        <div class="panel-heading">
          <h2>Mock Recap</h2>
          <span>Slot ${state.mySlot}</span>
        </div>
        <p class="empty">No picks for your team yet.</p>
      </section>
    `;
  }

  const recap = getDraftRecap(myPicks, ctx.myRoster);

  return `
    <section class="panel recap-panel">
      <div class="panel-heading">
        <h2>Mock Recap</h2>
        <span>${myPicks.length}/${leagueSettings.draftRounds} picks</span>
      </div>
      <div class="recap-score">
        <strong>${recap.grade}</strong>
        <span>${recap.summary}</span>
      </div>
      <div class="recap-grid">
        ${renderRecapBlock("Roster Shape", recap.shape)}
        ${renderRecapBlock("Build Bet", recap.identity)}
        ${renderRecapBlock("Best Values", recap.values)}
        ${renderRecapBlock("Reaches", recap.reaches)}
        ${renderRecapBlock("Bye Watch", recap.byes)}
        ${renderRecapBlock("Fix Next", recap.nextSteps)}
      </div>
    </section>
  `;
}

function renderRecapBlock(title, items) {
  return `
    <article class="recap-block">
      <h3>${title}</h3>
      ${items.length ? items.map((item) => `<p>${item}</p>`).join("") : "<p>Nothing major.</p>"}
    </article>
  `;
}

function renderDraftLabView() {
  const result = state.draftLabResult;
  const activeStrategy = getActiveStrategyMode();

  return `
    <section class="panel lab-panel">
      <div class="panel-heading">
        <h2>Draft Lab</h2>
        <span>${state.mySlot ? `Slot ${state.mySlot} - ${activeStrategy.label}` : "Set your slot"}</span>
      </div>
      <div class="lab-hero">
        <div>
          <span class="label">Batch Mock</span>
          <strong>${result ? `${result.mockCount} mocks` : "No batch yet"}</strong>
          <em>${state.mySlot ? "Runs auto-drafts using current strategy and team profiles." : "Choose your draft slot first."}</em>
        </div>
        <button class="primary-lite" data-action="run-draft-lab" ${state.mySlot ? "" : "disabled"}>Run 100 Mocks</button>
      </div>
      ${result ? renderDraftLabResult(result) : "<p class='empty'>Run a batch to see common builds, players, and weak spots.</p>"}
    </section>
  `;
}

function renderDraftLabResult(result) {
  return `
    <div class="lab-score">
      <strong>${Math.round(result.avgScore)}</strong>
      <span>Average score</span>
      <em>${formatLabTimestamp(result.createdAt)}</em>
    </div>
    <div class="lab-grid">
      ${renderLabBlock("Grades", topCounts(result.gradeCounts, 5).map((item) => `${item.label}: ${item.count}/${result.mockCount}`))}
      ${renderLabBlock("Common Builds", result.topRosterShapes.map((item) => `${item.label} - ${item.count}x`))}
      ${renderLabBlock("Common Starts", result.topFirstFive.map((item) => `${item.count}x - ${item.label}`))}
      ${renderLabBlock("Frequent Skill Players", result.topPlayers.slice(0, 6).map((item) => `${item.label} - ${item.count}x`))}
      ${renderLabBlock("DEF Timing", getDraftLabDefenseItems(result))}
      ${renderLabBlock("QB Timing", getDraftLabQbTimingItems(result))}
      ${renderLabBlock("TE Timing", getDraftLabTeTimingItems(result))}
      ${renderLabBlock("Thin Spots", getDraftLabThinSpotItems(result))}
    </div>
  `;
}

function renderLabBlock(title, items) {
  return `
    <article class="lab-block">
      <h3>${title}</h3>
      ${items.length ? items.map((item) => `<p>${item}</p>`).join("") : "<p>Nothing major.</p>"}
    </article>
  `;
}

function getDraftLabThinSpotItems(result) {
  const flags = result.thinFlags;
  return [
    `RB under 4: ${flags.rbThin}/${result.mockCount}`,
    `WR under 5: ${flags.wrThin}/${result.mockCount}`,
    `No QB: ${flags.noQb}/${result.mockCount}`,
    `No TE: ${flags.noTe}/${result.mockCount}`,
    `No DEF: ${flags.noDef}/${result.mockCount}`
  ];
}

function getDraftLabDefenseItems(result) {
  const defenses = result.topDefenses ?? [];
  return [
    `No DEF: ${result.thinFlags.noDef}/${result.mockCount}`,
    ...(defenses.length ? defenses.map((item) => `${item.label} - ${item.count}x`) : ["No defense drafted in these mocks."])
  ];
}

function getDraftLabQbTimingItems(result) {
  const timing = result.qbTiming;
  if (!timing) return [];
  const items = [
    `Josh Allen: ${timing.joshAllenCount}/${result.mockCount}`,
    `Elite QB: ${timing.eliteQbCount}/${result.mockCount}`,
    `Backup QB: ${timing.backupQbCount}/${result.mockCount}`
  ];

  if (timing.avgFirstQbRound) items.push(`Avg first QB: Round ${formatOneDecimal(timing.avgFirstQbRound)}`);
  if (timing.firstQbRounds?.length) items.push(`First QB rounds: ${timing.firstQbRounds.map((item) => `${item.label} ${item.count}x`).join(", ")}`);
  if (timing.eliteImpact) items.push(`Elite QB build: ${Math.round(timing.eliteImpact.avgScore)} score, RB ${formatOneDecimal(timing.eliteImpact.avgRb)}, WR ${formatOneDecimal(timing.eliteImpact.avgWr)}`);
  if (timing.nonEliteImpact) items.push(`Non-elite QB build: ${Math.round(timing.nonEliteImpact.avgScore)} score, RB ${formatOneDecimal(timing.nonEliteImpact.avgRb)}, WR ${formatOneDecimal(timing.nonEliteImpact.avgWr)}`);

  return items;
}

function getDraftLabTeTimingItems(result) {
  const timing = result.teTiming;
  if (!timing) return [];
  const items = [
    `Elite TE: ${timing.eliteTeCount}/${result.mockCount}`,
    `Backup TE: ${timing.backupTeCount}/${result.mockCount}`,
    `TE3 builds: ${timing.threeTeCount}/${result.mockCount}`
  ];

  if (timing.avgFirstTeRound) items.push(`Avg first TE: Round ${formatOneDecimal(timing.avgFirstTeRound)}`);
  if (timing.firstTeRounds?.length) items.push(`First TE rounds: ${timing.firstTeRounds.map((item) => `${item.label} ${item.count}x`).join(", ")}`);
  if (timing.topTes?.length) items.push(`Frequent TEs: ${timing.topTes.map((item) => `${item.label} ${item.count}x`).join(", ")}`);
  if (timing.eliteImpact) items.push(`Elite TE build: ${Math.round(timing.eliteImpact.avgScore)} score, RB ${formatOneDecimal(timing.eliteImpact.avgRb)}, WR ${formatOneDecimal(timing.eliteImpact.avgWr)}`);
  if (timing.nonEliteImpact) items.push(`Non-elite TE build: ${Math.round(timing.nonEliteImpact.avgScore)} score, RB ${formatOneDecimal(timing.nonEliteImpact.avgRb)}, WR ${formatOneDecimal(timing.nonEliteImpact.avgWr)}`);

  return items;
}

function formatOneDecimal(value) {
  return Number(value).toFixed(1).replace(/\.0$/g, "");
}

function formatLabTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderTeamsView() {
  const sortLabel = state.teamSort === "draft" ? "Draft Order" : "Roster";
  return `
    <section class="panel team-name-panel">
      <div class="panel-heading">
        <h2>Team Names</h2>
        <span>Saved on this device</span>
      </div>
      <div class="team-toolbar">
        <button class="${state.teamSort === "roster" ? "active" : ""}" data-team-sort="roster">Roster</button>
        <button class="${state.teamSort === "draft" ? "active" : ""}" data-team-sort="draft">Draft Order</button>
      </div>
      <div class="team-name-grid">
        ${state.teamNames.map((name, index) => {
          const teamSlot = index + 1;
          return `
            <label class="team-name-row ${state.mySlot === teamSlot ? "mine" : ""}">
              <span>${teamSlot}</span>
              <input data-team-name="${teamSlot}" value="${escapeHtml(name)}" placeholder="Team ${teamSlot}" autocomplete="off" />
            </label>
          `;
        }).join("")}
      </div>
      <div class="export-panel">
        <div class="backup-actions">
          <button class="primary-lite" data-action="backup-draft">Backup Current Draft</button>
          <button class="secondary" data-action="choose-restore">Restore Backup</button>
        </div>
        <button class="primary-lite" data-action="export-draft" ${state.picks.length ? "" : "disabled"}>Export Draft History</button>
        <input class="file-input" type="file" accept="application/json,.json" data-input="restore-backup" />
        <span>${state.picks.length ? `${state.picks.length}/${getTotalPicks()} picks ready` : "Enter picks before exporting"}</span>
      </div>
    </section>
    ${renderDataImportPanel()}
    <section class="teams-grid">
      ${state.teamNames.map((name, index) => {
        const teamSlot = index + 1;
        const picks = state.picks.filter((pick) => pick.teamSlot === teamSlot);
        const rosterRows = getTeamRosterRows(picks);
        const draftRows = getTeamDraftRows(picks, rosterRows);
        const rows = state.teamSort === "draft" ? draftRows : rosterRows;
        return `
          <article class="team-card ${state.mySlot === teamSlot ? "mine" : ""}">
            <div class="team-card-heading">
              <h2>${state.mySlot === teamSlot ? `My Team - ${name}` : name}</h2>
              <span>${sortLabel}</span>
            </div>
            ${renderTeamProfileControls(teamSlot)}
            <div class="team-roster">
              ${rows.length ? rows.map(renderTeamRosterRow).join("") : "<p class='empty'>No picks yet</p>"}
            </div>
          </article>
        `;
      }).join("")}
    </section>
  `;
}

function renderTeamProfileControls(teamSlot) {
  const profile = getTeamProfile(teamSlot);
  return `
    <div class="profile-grid">
      ${renderProfileSelect(teamSlot, "qb", "QB", profile.qb)}
      ${renderProfileSelect(teamSlot, "def", "DEF", profile.def)}
      ${renderProfileSelect(teamSlot, "position", "Bias", profile.position)}
      ${renderProfileSelect(teamSlot, "reach", "Reach", profile.reach)}
    </div>
  `;
}

function renderProfileSelect(teamSlot, field, label, value) {
  return `
    <label class="profile-field">
      <span>${label}</span>
      <select data-team-profile="${teamSlot}" data-profile-field="${field}">
        ${TEAM_PROFILE_OPTIONS[field].map((option) => `<option value="${option.id}" ${value === option.id ? "selected" : ""}>${option.label}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderDataImportPanel() {
  const status = getPlayerDataStatus();
  const sources = getActiveRankingSources();
  return `
    <section class="panel data-panel">
      <div class="panel-heading">
        <h2>Rankings Data</h2>
        <span>${status.label}</span>
      </div>
      <div class="data-actions">
        <button class="primary-lite" data-action="choose-rankings-import">Import Rankings CSV</button>
        <button class="secondary" data-action="choose-draft-sharks-import">Import Draft Sharks CSV</button>
        <button class="secondary" data-action="choose-generic-ranking-import">Import Ranking Source</button>
        <button class="secondary" data-action="choose-adp-import">Import ADP CSV</button>
        <button class="secondary" data-action="reset-player-data" ${playerData ? "" : "disabled"}>Use Bundled Data</button>
      </div>
      <input class="file-input" type="file" accept=".csv,text/csv" data-input="rankings-import" />
      <input class="file-input" type="file" accept=".csv,text/csv" data-input="draft-sharks-import" />
      <input class="file-input" type="file" accept=".csv,text/csv" data-input="generic-ranking-import" />
      <input class="file-input" type="file" accept=".csv,text/csv" data-input="adp-import" />
      <div class="source-list">
        ${sources.map(renderRankingSourceRow).join("")}
      </div>
      ${renderRankingImportPreview()}
      <div class="data-status">
        <strong>${status.title}</strong>
        <span>${status.detail}</span>
      </div>
    </section>
  `;
}

function renderRankingSourceRow(source) {
  const matchCount = playerData?.sourceMatches?.[source.id];
  return `
    <div class="source-row">
      <div>
        <strong>${escapeHtml(source.name)}</strong>
        <em>${escapeHtml(source.fileName ?? "Bundled source")}${matchCount !== undefined ? ` - ${matchCount} matches` : ""}</em>
      </div>
      <label>
        <span>Weight</span>
        <input type="number" min="1" max="100" step="1" value="${source.weight}" data-source-weight="${source.id}" ${playerData ? "" : "disabled"} />
      </label>
      ${source.id.startsWith("custom-") ? `<button class="mini-button danger-mini" data-remove-source="${source.id}">Remove</button>` : ""}
    </div>
  `;
}

function renderRankingImportPreview() {
  if (!pendingRankingImport) return "";
  const preview = pendingRankingImport;
  return `
    <div class="import-preview">
      <div class="import-preview-head">
        <div>
          <strong>Preview ${escapeHtml(preview.sourceName)}</strong>
          <em>${escapeHtml(preview.fileName)} - weight ${preview.weight}</em>
        </div>
        <span>${preview.matchCount}/${preview.rowCount} matched</span>
      </div>
      ${preview.warnings.length ? `<div class="import-warnings">${preview.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : ""}
      <div class="preview-grid">
        <article>
          <h3>Rank Movers</h3>
          ${preview.movers.length ? preview.movers.map((player) => `
            <p>${escapeHtml(player.name)} <span>${player.beforeRank} to ${player.afterRank} (${formatRankDelta(player.delta)})</span></p>
          `).join("") : "<p>No major rank movement.</p>"}
        </article>
        <article>
          <h3>Unmatched Samples</h3>
          ${preview.unmatched.length ? preview.unmatched.map((name) => `<p>${escapeHtml(name)}</p>`).join("") : "<p>All sampled rows matched.</p>"}
        </article>
      </div>
      <div class="preview-actions">
        <button class="primary-lite" data-action="apply-ranking-import">Apply Import</button>
        <button class="secondary" data-action="cancel-ranking-import">Cancel</button>
      </div>
    </div>
  `;
}

function renderRecentPicks() {
  const recent = state.picks
    .map((pick, index) => ({ pick, index }))
    .slice(-8)
    .reverse();
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Recent Picks</h2>
        <span>${state.picks.length} drafted</span>
      </div>
      ${recent.length ? recent.map(({ pick, index }) => `
        <div class="pick-row">
          <span>${pick.overallPick}</span>
          <strong>${pick.player.name}</strong>
          <em>${pick.player.position} - ${getTeamName(pick.teamSlot)}${pick.mocked ? " - mocked" : ""}</em>
          <div class="pick-actions">
            <button class="mini-button" data-edit-pick="${index}">Edit</button>
            <button class="mini-button danger-mini" data-delete-pick="${index}">Delete</button>
          </div>
        </div>
      `).join("") : "<p class='empty'>No picks entered yet.</p>"}
    </section>
  `;
}

function renderCorrectionPanel(ctx) {
  if (state.editPickIndex === null || !state.picks[state.editPickIndex]) return "";

  const pick = state.picks[state.editPickIndex];
  const query = state.editSearch.trim().toLowerCase();
  const players = getCorrectionPlayers(ctx.available, state.editPickIndex, query).slice(0, 10);

  return `
    <section class="panel correction-panel">
      <div class="panel-heading">
        <h2>Correct Pick ${pick.overallPick}</h2>
        <span>${getTeamName(pick.teamSlot)}</span>
      </div>
      <div class="correction-current">
        <span>Current</span>
        <strong>${pick.player.name}</strong>
        <em>${pick.player.position} - ${pick.player.team}</em>
      </div>
      <div class="correction-tools">
        <input class="search" data-input="edit-search" value="${escapeHtml(state.editSearch)}" placeholder="Search replacement player" autocomplete="off" />
        <button class="secondary" data-action="cancel-edit">Cancel</button>
      </div>
      <div class="player-list compact correction-list">
        ${players.length ? players.map((player) => renderReplaceRow(player, state.editPickIndex)).join("") : "<p class='empty'>No matching undrafted players.</p>"}
      </div>
    </section>
  `;
}

function renderRosterSlot(slot, players) {
  const limit = leagueSettings.rosterSlots[slot] ?? 0;
  const rows = Array.from({ length: Math.max(limit, players.length) }, (_, index) => {
    const player = players[index];
    return `<div class="roster-row"><span>${slot}</span><strong>${player ? player.name : "Open"}</strong><em>${player ? `${player.position} - ${player.team}` : ""}</em></div>`;
  });
  return rows.join("");
}

function renderReplaceRow(player, pickIndex) {
  return `
    <button class="player-row" data-replace-pick="${pickIndex}" data-replace-player="${player.id}">
      <span class="rank">${player.rank}</span>
      <span class="player-main">
        <strong>${player.name}</strong>
        <em>${player.position} - ${player.team} - Tier ${player.tier}</em>
      </span>
      <span class="meta">Use here</span>
    </button>
  `;
}

function renderTeamRosterRow(row) {
  const pick = row.pick;
  return `
    <div class="team-roster-row ${pick ? "filled" : ""}">
      <span class="team-roster-slot">${row.slot}</span>
      <strong>${pick ? pick.player.name : "Open"}</strong>
      <em>${pick ? `${pick.player.position} - ${pick.player.team}` : ""}</em>
      <span class="team-roster-pick">${pick ? formatDraftPickLabel(pick) : "--"}</span>
    </div>
  `;
}

function getTeamRosterRows(picks) {
  const rows = TEAM_ROSTER_TEMPLATE.map((slot) => ({ slot, pick: null }));

  for (const pick of picks) {
    const slotIndex = getTeamRosterSlotIndex(rows, pick.player.position);
    if (slotIndex !== -1) rows[slotIndex].pick = pick;
  }

  return rows;
}

function getTeamDraftRows(picks, rosterRows) {
  return [...picks]
    .sort((a, b) => a.overallPick - b.overallPick)
    .map((pick) => {
      const assignedRow = rosterRows.find((row) => row.pick?.overallPick === pick.overallPick);
      return {
        slot: assignedRow?.slot ?? "BN",
        pick
      };
    });
}

function getTeamRosterSlotIndex(rows, position) {
  const primarySlot = position === "DEF" ? "DST" : position;
  const primaryIndex = rows.findIndex((row) => row.slot === primarySlot && !row.pick);
  if (primaryIndex !== -1) return primaryIndex;

  if (["RB", "WR", "TE"].includes(position)) {
    const flexIndex = rows.findIndex((row) => row.slot === "FLEX" && !row.pick);
    if (flexIndex !== -1) return flexIndex;
  }

  return rows.findIndex((row) => row.slot === "BN" && !row.pick);
}

function formatDraftPickLabel(pick) {
  return `R${pick.round} P${pick.pickInRound}`;
}

function renderPlayerRow(player, meta, canDraft, currentPick = state.picks.length + 1) {
  return `
    <button class="player-row ${player.breakdown ? "has-breakdown" : ""}" ${canDraft ? `data-draft="${player.id}"` : ""}>
      <span class="rank">${player.rank}</span>
      <span class="player-main">
        <strong>${player.name}</strong>
        <em>${player.position} - ${player.team} - Tier ${player.tier}</em>
        <span class="player-stats">
          <span>Rank ${player.rank}</span>
          ${player.draftSharksRank ? `<span>DS ${player.draftSharksRank}</span>` : ""}
          ${player.sourceCount > 1 ? `<span>${player.sourceCount} src</span>` : ""}
          <span>ADP ${formatAdp(player.adp)}</span>
          <span class="${getValueClass(player, currentPick)}">${formatValue(player, currentPick)}</span>
        </span>
        ${renderScoreBreakdown(player)}
      </span>
      <span class="meta">${meta}</span>
    </button>
  `;
}

function renderScoreBreakdown(player) {
  if (!player.breakdown?.length) return "";

  return `
    <span class="score-breakdown">
      ${player.breakdown.map((item) => `<span class="${item.value < 0 ? "negative" : "positive"}">${item.label} ${formatSignedScore(item.value)}</span>`).join("")}
    </span>
  `;
}

function formatScore(score) {
  const rounded = Math.round(score);
  return `Score ${rounded}`;
}

function formatSignedScore(value) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatRankDelta(delta) {
  return delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
}

function isLikelyGoneBefore(player, targetPick) {
  const adp = Number(player.adp);
  if (!Number.isFinite(adp)) return false;
  if (adp > leagueSettings.teams * leagueSettings.draftRounds + 12) return false;
  return adp <= targetPick + 1;
}

function formatAdp(adp) {
  const number = Number(adp);
  if (!Number.isFinite(number) || number > leagueSettings.teams * leagueSettings.draftRounds + 12) return "--";
  return number % 1 === 0 ? String(number) : number.toFixed(1);
}

function getValueGap(player, currentPick) {
  const adp = Number(player.adp);
  if (!Number.isFinite(adp) || adp > leagueSettings.teams * leagueSettings.draftRounds + 12) return null;
  return currentPick - adp;
}

function formatValue(player, currentPick) {
  const gap = getValueGap(player, currentPick);
  if (gap === null) return "Value --";
  if (Math.abs(gap) < 0.5) return "At ADP";
  const rounded = Math.round(gap);
  return rounded > 0 ? `Value +${rounded}` : `Early ${rounded}`;
}

function getValueClass(player, currentPick) {
  const gap = getValueGap(player, currentPick);
  if (gap === null) return "value-neutral";
  if (gap >= 6) return "value-good";
  if (gap <= -6) return "value-reach";
  return "value-neutral";
}

function getFocusedBoard(players) {
  return players.filter((player) => player.rank <= BOARD_LIMIT || isUsefulAdp(player.adp));
}

function isUsefulAdp(adp) {
  const number = Number(adp);
  return Number.isFinite(number) && number <= leagueSettings.teams * leagueSettings.draftRounds + 12;
}

function getRecommendationTargetPick(currentPick, upcoming) {
  if (!upcoming.length) return null;
  if (upcoming[0] === currentPick) return upcoming[1] ?? null;
  return upcoming[0];
}

function getBestPickExplanation(player, ctx) {
  const reasons = [];
  const needs = getRosterNeeds(ctx.myRoster);
  const targetPick = getNextTargetPick(ctx);
  const remainingRosterPicks = leagueSettings.draftRounds - getRosterCount(ctx.myRoster);

  if (needs[player.position] > 0) reasons.push(`Fills ${player.position} starter need`);
  if (["RB", "WR", "TE"].includes(player.position) && needs[player.position] === 0 && needs.FLEX > 0) reasons.push("Fits open flex spot");
  if (player.position === "WR") reasons.push("Full PPR plus 3 WR format");
  const stackFit = getStackFit(player, ctx.myRoster, ctx.currentPick);
  if (stackFit) reasons.push(`Stack fit with ${stackFit.name}`);
  if (isLikelyGoneBefore(player, targetPick ?? ctx.currentPick)) reasons.push("ADP says he may not return");
  if (hasTierDropAfter(player, ctx.available)) reasons.push(`${player.position} tier dries up soon`);
  if (player.position === "QB") reasons.push("Only worth it if the value is clear");
  if (player.position === "DEF") {
    reasons.push(remainingRosterPicks <= 3 ? "Required DEF slot" : "Defense should usually wait");
  }

  return reasons.slice(0, 4);
}

function getDraftRecap(myPicks, roster) {
  const positionCounts = getPositionCounts(myPicks);
  const needs = getRosterNeeds(roster);
  const values = getValuePicks(myPicks, "value");
  const reaches = getValuePicks(myPicks, "reach");
  const byes = getByeWatch(myPicks);
  const nextSteps = getRecapNextSteps(needs, positionCounts, myPicks.length, reaches, byes);
  const identity = getBuildIdentity(myPicks, roster, positionCounts);
  const gradeScore = getRecapScore(needs, values, reaches, byes, myPicks.length);

  return {
    grade: getRecapGrade(gradeScore),
    score: gradeScore,
    summary: getRecapSummary(gradeScore, myPicks.length),
    shape: [
      `QB ${positionCounts.QB}, RB ${positionCounts.RB}, WR ${positionCounts.WR}, TE ${positionCounts.TE}, DEF ${positionCounts.DEF}`,
      `${getRosterCount(roster)} of ${leagueSettings.draftRounds} roster spots filled`
    ],
    identity,
    values,
    reaches,
    byes,
    nextSteps
  };
}

function getPositionCounts(picks) {
  return picks.reduce((counts, pick) => {
    counts[pick.player.position] = (counts[pick.player.position] ?? 0) + 1;
    return counts;
  }, { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 });
}

function getValuePicks(picks, type) {
  return picks
    .map((pick) => ({ pick, gap: getValueGap(pick.player, pick.overallPick) }))
    .filter(({ gap }) => gap !== null && (type === "value" ? gap >= 8 : gap <= -10))
    .sort((a, b) => type === "value" ? b.gap - a.gap : a.gap - b.gap)
    .slice(0, 3)
    .map(({ pick, gap }) => `${pick.player.name}: ${gap > 0 ? "+" : ""}${Math.round(gap)} vs ADP`);
}

function getByeWatch(picks) {
  const byeCounts = picks.reduce((counts, pick) => {
    const bye = pick.player.bye;
    if (!bye || bye === "--") return counts;
    counts[bye] = (counts[bye] ?? 0) + 1;
    return counts;
  }, {});

  return Object.entries(byeCounts)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([bye, count]) => `${count} players on bye week ${bye}`);
}

function getRecapNextSteps(needs, counts, pickCount, reaches = [], byes = []) {
  const steps = [];
  if (needs.DEF > 0 && leagueSettings.draftRounds - pickCount <= 3) steps.push("Plan DEF before the final pick window closes.");
  if (needs.QB > 0 && pickCount >= 9) steps.push("QB is still open. Stop waiting unless value is ugly.");
  if (needs.TE > 0 && pickCount >= 8) steps.push("TE is still open. Look for value or a safe floor soon.");
  if (needs.WR > 0) steps.push(`${needs.WR} WR starter slot${needs.WR > 1 ? "s" : ""} still open.`);
  if (counts.RB < 3 && pickCount >= 8) steps.push("RB depth is thin for bye weeks and injuries.");
  if (counts.WR < 4 && pickCount >= 8) steps.push("WR depth is thin for a 3-WR full PPR league.");
  if (pickCount >= leagueSettings.draftRounds && byes.length) steps.push("Bye week cluster is worth watching after waivers.");
  if (pickCount >= leagueSettings.draftRounds && reaches.length >= 2) steps.push("A few picks were early by ADP, but roster structure matters more.");
  return steps.slice(0, 3);
}

function getBuildIdentity(picks, roster, counts) {
  const identity = [];
  const firstThree = picks.slice(0, 3).map((pick) => pick.player.position);
  const eliteQb = roster.QB.some((player) => Number(player.positionalRank) <= 5);
  const eliteTe = roster.TE.some((player) => Number(player.positionalRank) <= 5);

  if (firstThree.filter((position) => position === "WR").length >= 2) identity.push("WR-heavy opening built for full PPR.");
  if (firstThree.filter((position) => position === "RB").length >= 2) identity.push("RB-heavy opening with weekly floor.");
  if (eliteQb) identity.push("Elite QB build, so backup QB can wait.");
  if (eliteTe) identity.push("Elite TE build, so backup TE can wait.");
  if (counts.WR >= 7) identity.unshift("WR-heavy depth build for full PPR.");
  else if (counts.WR >= counts.RB + 2) identity.push("Leaning into receiver depth.");
  if (counts.RB >= 6) identity.unshift("RB-heavy depth build.");
  else if (counts.RB >= counts.WR + 2) identity.push("Leaning into running back depth.");

  return identity.slice(0, 3);
}

function getDraftPlan(ctx) {
  const rosterPlayers = Object.values(ctx.myRoster).flat();
  const counts = getPositionCounts(rosterPlayers.map((player) => ({ player })));
  const needs = getRosterNeeds(ctx.myRoster);
  const round = ctx.currentInfo.round;
  const bestPick = ctx.recommendations[0];
  const remainingPicks = Math.max(leagueSettings.draftRounds - getRosterCount(ctx.myRoster), 0);
  const requiredOpenSlots = needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF;

  return {
    currentLean: getPlanLean(bestPick, needs, counts, round),
    summary: getPlanSummary(counts, needs, round, remainingPicks, requiredOpenSlots),
    now: getPlanNowItems(ctx, counts, needs),
    rounds: getRoundPlanItems(round, counts, needs),
    targets: getRosterTargetItems(counts, needs),
    guardrails: getPlanGuardrails(counts, needs, round, remainingPicks, requiredOpenSlots)
  };
}

function getPlanLean(bestPick, needs, counts, round) {
  if (!bestPick) return "No board available";
  if (needs.DEF > 0 && round >= 14) return "DEF must enter the plan";
  if (counts.WR >= 7) return "Balance away from extra WR";
  if (counts.RB < 4 && round >= 8) return "Add RB depth";
  if (needs.WR > 0) return "Fill WR starters";
  if (needs.RB > 0) return "Fill RB starters";
  if (needs.TE > 0 && round >= 7) return "Find TE value";
  if (needs.QB > 0 && round >= 7) return "Find QB value";
  return `Lean ${bestPick.position}`;
}

function getPlanSummary(counts, needs, round, remainingPicks, requiredOpenSlots) {
  if (remainingPicks <= requiredOpenSlots) return "Every remaining pick needs to solve a roster slot.";
  if (round <= 5) return "Build starters and avoid forcing onesie positions unless value is obvious.";
  if (round <= 10) return "Finish starters, protect RB/WR depth, and watch tier drops before your next pick.";
  return "Close required slots, avoid extra QB/TE, and take DEF only when the final rounds arrive.";
}

function getPlanNowItems(ctx, counts, needs) {
  const bestPick = ctx.recommendations[0];
  const items = [];
  if (bestPick) {
    items.push({
      title: bestPick.name,
      detail: `${bestPick.position} - tier ${bestPick.tier} - ${bestPick.reason}`
    });
  }
  if (needs.WR > 0) items.push({ title: "WR starters open", detail: `${needs.WR} WR slot${needs.WR > 1 ? "s" : ""} still need to be filled.` });
  if (needs.RB > 0) items.push({ title: "RB starters open", detail: `${needs.RB} RB slot${needs.RB > 1 ? "s" : ""} still need to be filled.` });
  if (counts.WR >= 6) items.push({ title: "WR depth is high", detail: "Only add another WR if rank/tier/value clearly beat alternatives." });
  if (counts.RB < 4 && ctx.currentInfo.round >= 8) items.push({ title: "RB depth check", detail: "Try to leave the draft with at least 5 RB if the board cooperates." });
  return items.slice(0, 4);
}

function getRoundPlanItems(round, counts, needs) {
  if (round <= 3) {
    return [
      { title: "Rounds 1-3", detail: "Prioritize elite RB/WR. Take elite QB/TE only when the value is clearly there." },
      { title: "Avoid", detail: "Do not chase DEF or bench QB this early." }
    ];
  }

  if (round <= 7) {
    return [
      { title: "Rounds 4-7", detail: "Finish core RB/WR starters and start watching QB/TE tier value." },
      { title: "Target shape", detail: `By round 7, aim near RB 3+, WR 4+, QB ${needs.QB ? "optional" : "done"}, TE ${needs.TE ? "optional" : "done"}.` }
    ];
  }

  if (round <= 11) {
    return [
      { title: "Rounds 8-11", detail: "Add RB/WR depth. QB/TE are acceptable if value or stack logic says yes." },
      { title: "Depth balance", detail: `Current depth: RB ${counts.RB}, WR ${counts.WR}. Do not let one side get too thin.` }
    ];
  }

  return [
    { title: "Rounds 12-15", detail: "Close mandatory slots, add upside depth, and take DEF before the end." },
    { title: "Avoid", detail: "Do not take backup QB/TE unless the value is extreme or your starter is weak." }
  ];
}

function getRosterTargetItems(counts, needs) {
  return [
    { title: "Ideal final shape", detail: "QB 1, RB 5-6, WR 5-7, TE 1-2, DEF 1." },
    { title: "Current shape", detail: `QB ${counts.QB}, RB ${counts.RB}, WR ${counts.WR}, TE ${counts.TE}, DEF ${counts.DEF}.` },
    { title: "Open slots", detail: `QB ${needs.QB}, RB ${needs.RB}, WR ${needs.WR}, TE ${needs.TE}, FLEX ${needs.FLEX}, DEF ${needs.DEF}.` }
  ];
}

function getPlanGuardrails(counts, needs, round, remainingPicks, requiredOpenSlots) {
  const guardrails = [];
  if (counts.WR >= 7) guardrails.push({ title: "Stop WR drift", detail: "Extra WR must be a clear tier/value win." });
  if (counts.RB <= 3 && round >= 9) guardrails.push({ title: "RB depth risk", detail: "RB injuries and byes will hurt if depth stays thin." });
  if (needs.DEF > 0 && round < 13) guardrails.push({ title: "DEF can wait", detail: "Keep taking real roster value until the final rounds." });
  if (needs.DEF > 0 && round >= 14) guardrails.push({ title: "DEF required", detail: "Do not leave the draft without filling DEF." });
  if (counts.QB >= 1) guardrails.push({ title: "No QB chase", detail: "A second QB needs extreme value. Let your league overpay." });
  if (counts.TE >= 1) guardrails.push({ title: "No TE chase", detail: "A second TE needs clear value or flex utility." });
  if (remainingPicks <= requiredOpenSlots + 1) guardrails.push({ title: "Slot pressure", detail: "Prioritize required roster slots over luxury depth." });
  return guardrails.slice(0, 4);
}

function getRecapScore(needs, values, reaches, byes, pickCount) {
  let score = pickCount >= leagueSettings.draftRounds ? 84 : 78;
  score += Math.min(values.length * 5, 12);
  score -= Math.min(reaches.length * 2, 6);
  score -= Math.min(byes.length * 2, 4);
  if (needs.WR > 0 && pickCount >= 8) score -= 10;
  if (needs.RB > 0 && pickCount >= 8) score -= 9;
  if (needs.QB > 0 && pickCount >= 10) score -= 8;
  if (needs.TE > 0 && pickCount >= 10) score -= 7;
  if (needs.DEF > 0 && leagueSettings.draftRounds - pickCount <= 2) score -= 6;
  return score;
}

function getRecapGrade(score) {
  if (score >= 88) return "A";
  if (score >= 80) return "B";
  if (score >= 72) return "C";
  return "Needs Work";
}

function getRecapSummary(score, pickCount) {
  if (pickCount < leagueSettings.draftRounds) return "In-progress read based on your picks so far.";
  if (score >= 88) return "Strong structure with useful value pockets.";
  if (score >= 80) return "This mock has a usable roster shape with manageable weak spots.";
  if (score >= 72) return "The core is workable, but the build needs cleaner depth or value.";
  return "This mock left too many roster problems to feel comfortable.";
}

function getNextTargetPick(ctx) {
  if (!state.mySlot) return null;
  if (ctx.upcoming[0] === ctx.currentPick) return ctx.upcoming[1] ?? null;
  return ctx.upcoming[0] ?? null;
}

function hasTierDropAfter(player, available) {
  const samePosition = available.filter((candidate) => candidate.position === player.position && candidate.rank > player.rank);
  if (!samePosition.length) return false;
  return samePosition[0].tier > player.tier;
}

function getPositionRunAlert(picks) {
  const recent = picks.slice(-8);
  if (recent.length < 5) return null;

  const counts = recent.reduce((acc, pick) => {
    acc[pick.player.position] = (acc[pick.player.position] ?? 0) + 1;
    return acc;
  }, {});

  const [position, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!position || count < 4) return null;

  return {
    title: `${position} run happening`,
    detail: `${count} of the last ${recent.length} picks were ${position}. Check the tier before waiting.`
  };
}

function getRosterWarnings(ctx) {
  if (!state.mySlot) return [];

  const warnings = [];
  const needs = getRosterNeeds(ctx.myRoster);
  const targetPick = getNextTargetPick(ctx);
  const futureWindow = targetPick ? targetPick + 1 : ctx.currentPick + leagueSettings.teams;
  const remainingRosterPicks = leagueSettings.draftRounds - getRosterCount(ctx.myRoster);

  for (const position of ["RB", "WR", "TE", "QB"]) {
    if (needs[position] <= 0) continue;
    if (position === "TE" && ctx.currentPick < 31) continue;
    if (position === "QB" && ctx.currentPick < 61) continue;

    const likelyAvailableBeforeNextPick = ctx.available.filter(
      (player) => player.position === position && Number(player.adp) <= futureWindow && player.rank <= BOARD_LIMIT
    ).length;

    if (position === "WR" && needs.WR >= 2) {
      warnings.push({
        level: "warning",
        title: "WR starters still open",
        detail: `${needs.WR} WR slots open. This format starts 3 WR plus flex.`
      });
      continue;
    }

    if (likelyAvailableBeforeNextPick <= needs[position] && targetPick) {
      warnings.push({
        level: "warning",
        title: `${position} supply is thin`,
        detail: `${likelyAvailableBeforeNextPick} likely ${position} options before your next pick, ${needs[position]} starter slot${needs[position] > 1 ? "s" : ""} open.`
      });
    }
  }

  if (needs.DEF > 0 && remainingRosterPicks <= 3) {
    warnings.push({
      level: "warning",
      title: "DEF slot still open",
      detail: `${remainingRosterPicks} roster pick${remainingRosterPicks === 1 ? "" : "s"} left. Defense needs to enter the plan now.`
    });
  } else if (needs.DEF > 0 && ctx.currentPick < getTotalPicks() - leagueSettings.teams) {
    warnings.push({
      level: "calm",
      title: "Do not force defense",
      detail: "DEF can wait unless your final rounds are here."
    });
  }

  return warnings.slice(0, 3);
}

function chooseMockPlayer(available, picks, pickInfo) {
  const roster = buildRoster(picks, pickInfo.teamSlot);
  const needs = getRosterNeeds(roster);
  const profile = getTeamProfile(pickInfo.teamSlot);
  const remainingRosterPicks = getMockRemainingRosterPicks(needs);
  const requiredOpenSlots = getMockRequiredOpenSlots(needs);
  const earlyElitePool = getEarlyEliteMockPool(available, pickInfo);
  const viablePlayers = earlyElitePool.length ? earlyElitePool : remainingRosterPicks <= requiredOpenSlots
    ? available.filter((player) => fillsMockRequiredSlot(player, needs))
    : available;

  const ranked = [...viablePlayers]
    .map((player) => ({
      player,
      score: getMockDraftScore(player, needs, pickInfo, roster, profile) + getMockRandomness(player, pickInfo, profile)
    }))
    .sort((a, b) => b.score - a.score);

  return pickWeightedMockPlayer(ranked, pickInfo, profile)?.player;
}

function getEarlyEliteMockPool(available, pickInfo) {
  if (pickInfo.overallPick > 4) return [];

  const topAvailable = [...available].sort((a, b) => a.rank - b.rank);
  const elitePool = topAvailable.filter((player) => player.rank <= 4);

  return elitePool.length ? elitePool : topAvailable.slice(0, Math.max(1, 5 - pickInfo.overallPick));
}

function getMockDraftScore(player, needs, pickInfo, roster, profile = DEFAULT_TEAM_PROFILE) {
  const adp = Number(player.adp);
  const marketPick = Number.isFinite(adp) && adp <= leagueSettings.teams * leagueSettings.draftRounds + 12 ? adp : player.rank;
  const round = pickInfo.round;
  const qbCount = getMockPositionCount(roster, "QB");
  let score = 500 - marketPick;

  if (needs[player.position] > 0) score += 18;
  if (["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0) score += 8;
  if (player.position === "WR") score += 5;
  if (player.position === "QB") score += getMockQbTendencyBonus(qbCount, round, needs, profile);
  if (player.position === "DEF") score += getMockDefenseTendencyBonus(round, needs, profile);
  score += getMockPositionBiasBonus(player, profile);
  if (player.position === "DEF" && needs.DEF <= 0) score -= 120;
  if (player.position === "DEF" && round < 13) score -= 180;
  if (needs.BENCH <= 0 && needs[player.position] <= 0) score -= 80;
  if (fillsMockRequiredSlot(player, needs) && getMockRemainingRosterPicks(needs) <= getMockRequiredOpenSlots(needs)) score += 210;
  if (player.position === "DEF" && needs.DEF > 0 && round >= 14) score += 260;

  return score;
}

function getMockRandomness(player, pickInfo, profile = DEFAULT_TEAM_PROFILE) {
  const round = pickInfo.round;
  const adp = Number(player.adp);
  const usefulAdp = Number.isFinite(adp) && adp <= leagueSettings.teams * leagueSettings.draftRounds + 12;
  const adpGap = usefulAdp ? pickInfo.overallPick - adp : 0;
  const openingPicks = pickInfo.overallPick <= 4;
  const earlyRounds = round <= 3;
  const lateRounds = round >= 10;
  const profileSpread = profile.reach === "chaotic" ? 1.45 : profile.reach === "conservative" ? 0.65 : 1;
  const spread = (openingPicks ? 8 : earlyRounds ? 18 : lateRounds ? 58 : 38) * profileSpread;
  let noise = (Math.random() - 0.5) * spread;

  if (player.position === "QB" && round >= 7 && Math.random() < (profile.qb === "two-plus" ? 0.3 : 0.18)) noise += 32;
  if (player.position === "DEF" && round >= (profile.def === "early" ? 10 : 12) && Math.random() < (profile.def === "early" ? 0.28 : 0.16)) noise += 42;
  if (["RB", "WR"].includes(player.position) && lateRounds && Math.random() < 0.22) noise += 28;
  if (usefulAdp && adpGap <= -18 && Math.random() < (profile.reach === "chaotic" ? 0.42 : 0.7)) noise -= 18;
  if (usefulAdp && adpGap >= 10 && Math.random() < 0.4) noise += 16;

  return noise;
}

function pickWeightedMockPlayer(ranked, pickInfo, profile = DEFAULT_TEAM_PROFILE) {
  if (!ranked.length) return null;

  const bestScore = ranked[0].score;
  const openingPicks = pickInfo.overallPick <= 4;
  const shortlist = openingPicks
    ? ranked.slice(0, 4)
    : ranked
      .filter((entry, index) => index < 8 || entry.score >= bestScore - 42)
      .slice(0, 14);
  const profileTemperature = profile.reach === "chaotic" ? 1.35 : profile.reach === "conservative" ? 0.72 : 1;
  const temperature = (openingPicks ? 10 : 22) * profileTemperature;
  const weighted = shortlist.map((entry) => ({
    ...entry,
    weight: Math.exp((entry.score - bestScore) / temperature)
  }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry;
  }

  return weighted[0];
}

function getMockQbTendencyBonus(qbCount, round, needs, profile = DEFAULT_TEAM_PROFILE) {
  const earlyBoost = profile.qb === "early" ? 48 : 0;
  const twoQbBoost = profile.qb === "two-plus" ? 58 : 0;

  if (qbCount === 0) {
    if (round >= 10) return 140 + twoQbBoost;
    if (round >= 8) return 82 + twoQbBoost;
    if (round >= 6) return 38 + earlyBoost + Math.round(twoQbBoost * 0.45);
    if (round >= 4) return earlyBoost;
    if (round <= 3) return -16;
    return 0;
  }

  if (qbCount === 1) {
    if (needs.BENCH <= 0) return -220;
    if (profile.qb !== "two-plus") {
      if (round <= 6) return -125;
      if (round === 7) return -65;
      if (round === 8) return -20;
      if (round === 9) return 35;
      if (round === 10) return 85;
      if (round === 11) return 125;
      return 170;
    }
    if (round <= 6) return -70;
    if (round === 7) return 5;
    if (round === 8) return 42;
    if (round === 9) return 92;
    if (round === 10) return 142;
    return 190;
  }

  if (qbCount === 2) {
    if (needs.BENCH <= 0) return -240;
    return round >= 14 ? -75 : -185;
  }

  return -260;
}

function getMockDefenseTendencyBonus(round, needs, profile = DEFAULT_TEAM_PROFILE) {
  if (profile.def !== "early" || needs.DEF <= 0) return 0;
  if (round >= 12) return 82;
  if (round >= 10) return 56;
  if (round >= 8) return 24;
  return 0;
}

function getMockPositionBiasBonus(player, profile = DEFAULT_TEAM_PROFILE) {
  if (profile.position === "rb" && player.position === "RB") return 16;
  if (profile.position === "rb" && player.position === "WR") return -6;
  if (profile.position === "wr" && player.position === "WR") return 16;
  if (profile.position === "wr" && player.position === "RB") return -6;
  return 0;
}

function getMockRequiredOpenSlots(needs) {
  return needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF;
}

function getMockRemainingRosterPicks(needs) {
  return needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX + needs.DEF + needs.BENCH;
}

function fillsMockRequiredSlot(player, needs) {
  if (needs[player.position] > 0) return true;
  return ["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0;
}

function getMockPositionCount(roster, position) {
  return Object.values(roster)
    .flat()
    .filter((player) => player.position === position).length;
}

function getCorrectionPlayers(available, pickIndex, query) {
  const currentPlayer = state.picks[pickIndex]?.player;
  const source = currentPlayer ? [currentPlayer, ...available] : available;
  const unique = new Map(source.map((player) => [player.id, player]));
  return [...unique.values()]
    .filter((player) => !query || `${player.name} ${player.team} ${player.position}`.toLowerCase().includes(query))
    .sort((a, b) => a.rank - b.rank);
}

function normalizePicks(picks) {
  return picks.map((pick, index) => ({
    ...pick,
    ...getPickInfo(index + 1)
  }));
}

function updateTeamName(teamSlot, value) {
  const names = [...state.teamNames];
  names[teamSlot - 1] = value.trim() || defaultTeamNames[teamSlot - 1];
  setState({ teamNames: names });
}

function saveTeamNameInput(teamSlot, value) {
  const names = [...state.teamNames];
  names[teamSlot - 1] = value;
  state = { ...state, teamNames: names };
  saveState();
}

function getTeamProfile(teamSlot) {
  return normalizeTeamProfile(state.teamProfiles?.[teamSlot - 1]);
}

function updateTeamProfile(teamSlot, field, value) {
  if (!isProfileOption(field, value)) return;
  const profiles = Array.from({ length: leagueSettings.teams }, (_, index) => getTeamProfile(index + 1));
  profiles[teamSlot - 1] = { ...profiles[teamSlot - 1], [field]: value };
  setState({ teamProfiles: profiles });
}

function getTeamName(teamSlot) {
  const name = String(state.teamNames[teamSlot - 1] ?? "").trim();
  return name || defaultTeamNames[teamSlot - 1];
}

function buildDraftHistoryExport() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: "Ward19 Draft Assistant",
      cacheVersion: APP_CACHE_VERSION
    },
    league: {
      name: leagueSettings.name,
      leagueId: leagueSettings.leagueId,
      teams: leagueSettings.teams,
      draftRounds: leagueSettings.draftRounds,
      scoring: leagueSettings.scoring,
      rosterSlots: leagueSettings.rosterSlots
    },
    mySlot: state.mySlot,
    teamNames: state.teamNames,
    picks: state.picks.map(serializePick),
    teams: Array.from({ length: leagueSettings.teams }, (_, index) => buildTeamHistory(index + 1))
  };
}

function serializePick(pick) {
  return {
    overallPick: pick.overallPick,
    round: pick.round,
    pickInRound: pick.pickInRound,
    teamSlot: pick.teamSlot,
    teamName: getTeamName(pick.teamSlot),
    mocked: Boolean(pick.mocked),
    player: serializePlayer(pick.player),
    valueVsAdp: getValueGap(pick.player, pick.overallPick)
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    bye: player.bye,
    rank: player.rank,
    fantasyProsRank: player.fantasyProsRank,
    compositeRank: player.compositeRank,
    draftSharksRank: player.draftSharksRank,
    draftSharksProjection: player.draftSharksProjection,
    draftSharks3dValue: player.draftSharks3dValue,
    tier: player.tier,
    positionalRank: player.positionalRank,
    adp: player.adp,
    beatAdpRank: player.beatAdpRank,
    yahooAdp: player.yahooAdp,
    sleeperAdp: player.sleeperAdp,
    espnAdp: player.espnAdp
  };
}

function buildTeamHistory(teamSlot) {
  const picks = state.picks.filter((pick) => pick.teamSlot === teamSlot);
  const positionCounts = picks.reduce((counts, pick) => {
    counts[pick.player.position] = (counts[pick.player.position] ?? 0) + 1;
    return counts;
  }, { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 });
  const firstByPosition = {};

  for (const position of ["QB", "RB", "WR", "TE", "DEF"]) {
    const firstPick = picks.find((pick) => pick.player.position === position);
    firstByPosition[position] = firstPick ? { round: firstPick.round, overallPick: firstPick.overallPick } : null;
  }

  return {
    teamSlot,
    teamName: getTeamName(teamSlot),
    profile: getTeamProfile(teamSlot),
    isMyTeam: state.mySlot === teamSlot,
    pickCount: picks.length,
    positionCounts,
    firstByPosition,
    tendencies: summarizeTeamTendencies(picks, positionCounts, firstByPosition),
    picks: picks.map(serializePick)
  };
}

function summarizeTeamTendencies(picks, positionCounts, firstByPosition) {
  const reaches = picks.filter((pick) => {
    const gap = getValueGap(pick.player, pick.overallPick);
    return gap !== null && gap <= -10;
  }).length;
  const values = picks.filter((pick) => {
    const gap = getValueGap(pick.player, pick.overallPick);
    return gap !== null && gap >= 10;
  }).length;

  return {
    draftedMultipleQbs: positionCounts.QB >= 2,
    qbCount: positionCounts.QB,
    firstQbRound: firstByPosition.QB?.round ?? null,
    earlyQb: (firstByPosition.QB?.round ?? 99) <= 5,
    earlyTe: (firstByPosition.TE?.round ?? 99) <= 5,
    earlyDefense: (firstByPosition.DEF?.round ?? 99) <= 12,
    rbHeavy: positionCounts.RB >= positionCounts.WR + 2,
    wrHeavy: positionCounts.WR >= positionCounts.RB + 2,
    reaches,
    values
  };
}

function bindEvents() {
  const refocusInputAtEnd = (selector) => {
    requestAnimationFrame(() => {
      const input = app.querySelector(selector);
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    });
  };

  app.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("click", () => setState({ mySlot: Number(button.dataset.slot) }));
  });

  app.querySelectorAll("[data-strategy]").forEach((button) => {
    button.addEventListener("click", () => setState({ strategyMode: button.dataset.strategy }));
  });

  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setState({ activeView: button.dataset.view }));
  });

  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => setState({ positionFilter: button.dataset.filter }));
  });

  app.querySelectorAll("[data-live-filter]").forEach((button) => {
    button.addEventListener("click", () => setState({ liveFilter: button.dataset.liveFilter }));
  });

  app.querySelectorAll("[data-team-sort]").forEach((button) => {
    button.addEventListener("click", () => setState({ teamSort: button.dataset.teamSort }));
  });

  app.querySelectorAll("[data-draft]").forEach((button) => {
    button.addEventListener("click", () => draftPlayer(button.dataset.draft));
  });

  app.querySelectorAll("[data-edit-pick]").forEach((button) => {
    button.addEventListener("click", () => startEditPick(Number(button.dataset.editPick)));
  });

  app.querySelectorAll("[data-delete-pick]").forEach((button) => {
    button.addEventListener("click", () => deletePick(Number(button.dataset.deletePick)));
  });

  app.querySelectorAll("[data-replace-pick]").forEach((button) => {
    button.addEventListener("click", () => replacePickPlayer(Number(button.dataset.replacePick), button.dataset.replacePlayer));
  });

  app.querySelectorAll("[data-team-name]").forEach((input) => {
    input.addEventListener("input", (event) => saveTeamNameInput(Number(event.target.dataset.teamName), event.target.value));
    input.addEventListener("change", (event) => updateTeamName(Number(event.target.dataset.teamName), event.target.value));
    input.addEventListener("blur", (event) => updateTeamName(Number(event.target.dataset.teamName), event.target.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.currentTarget.blur();
      }
    });
  });

  app.querySelectorAll("[data-team-profile]").forEach((select) => {
    select.addEventListener("change", (event) => updateTeamProfile(Number(event.target.dataset.teamProfile), event.target.dataset.profileField, event.target.value));
  });

  app.querySelector("[data-action='undo']")?.addEventListener("click", undoPick);
  app.querySelector("[data-action='reset']")?.addEventListener("click", resetDraft);
  app.querySelector("[data-action='cancel-edit']")?.addEventListener("click", cancelEditPick);
  app.querySelector("[data-action='export-draft']")?.addEventListener("click", exportDraftHistory);
  app.querySelector("[data-action='backup-draft']")?.addEventListener("click", backupCurrentDraft);
  app.querySelector("[data-action='choose-restore']")?.addEventListener("click", () => app.querySelector("[data-input='restore-backup']")?.click());
  app.querySelector("[data-input='restore-backup']")?.addEventListener("change", (event) => {
    restoreDraftBackup(event.target.files?.[0]);
    event.target.value = "";
  });
  app.querySelector("[data-action='choose-rankings-import']")?.addEventListener("click", () => app.querySelector("[data-input='rankings-import']")?.click());
  app.querySelector("[data-input='rankings-import']")?.addEventListener("change", (event) => {
    importFantasyProsRankings(event.target.files?.[0]);
    event.target.value = "";
  });
  app.querySelector("[data-action='choose-adp-import']")?.addEventListener("click", () => app.querySelector("[data-input='adp-import']")?.click());
  app.querySelector("[data-input='adp-import']")?.addEventListener("change", (event) => {
    importBeatAdp(event.target.files?.[0]);
    event.target.value = "";
  });
  app.querySelector("[data-action='choose-draft-sharks-import']")?.addEventListener("click", () => app.querySelector("[data-input='draft-sharks-import']")?.click());
  app.querySelector("[data-input='draft-sharks-import']")?.addEventListener("change", (event) => {
    importDraftSharksRankings(event.target.files?.[0]);
    event.target.value = "";
  });
  app.querySelector("[data-action='choose-generic-ranking-import']")?.addEventListener("click", () => app.querySelector("[data-input='generic-ranking-import']")?.click());
  app.querySelector("[data-input='generic-ranking-import']")?.addEventListener("change", (event) => {
    importGenericRankingSource(event.target.files?.[0]);
    event.target.value = "";
  });
  app.querySelectorAll("[data-source-weight]").forEach((input) => {
    input.addEventListener("change", (event) => updateRankingSourceWeight(event.target.dataset.sourceWeight, event.target.value));
  });
  app.querySelectorAll("[data-remove-source]").forEach((button) => {
    button.addEventListener("click", () => removeRankingSource(button.dataset.removeSource));
  });
  app.querySelector("[data-action='apply-ranking-import']")?.addEventListener("click", applyPendingRankingImport);
  app.querySelector("[data-action='cancel-ranking-import']")?.addEventListener("click", cancelPendingRankingImport);
  app.querySelector("[data-action='reset-player-data']")?.addEventListener("click", resetImportedPlayerData);
  app.querySelector("[data-action='mock-next']")?.addEventListener("click", autoDraftNextPick);
  app.querySelector("[data-action='mock-to-me']")?.addEventListener("click", autoDraftToMyPick);
  app.querySelector("[data-action='run-draft-lab']")?.addEventListener("click", () => runDraftLab(100));
  app.querySelector("[data-input='search']")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    saveState();
    render();
    refocusInputAtEnd("[data-input='search']");
  });
  app.querySelector("[data-input='edit-search']")?.addEventListener("input", (event) => {
    state.editSearch = event.target.value;
    saveState();
    render();
    refocusInputAtEnd("[data-input='edit-search']");
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

render();
