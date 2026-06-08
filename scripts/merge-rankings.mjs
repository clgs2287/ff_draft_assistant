import fs from "node:fs";
import path from "node:path";

const fantasyProsPath = process.argv[2] || "C:/Users/coryl/Downloads/FantasyPros_2026_Draft_ALL_Rankings.csv";
const beatAdpPath = process.argv[3] || "C:/Users/coryl/OneDrive/Documents/Fantasy_Draft_Assistant/Beat_ADP.csv";
const draftSharksPath = process.argv[4] || "C:/Users/coryl/Downloads/rankings-ppr.csv";
const outputPath = "src/data/fantasyProsPlayers.js";
const DRAFT_SHARKS_WEIGHT = 0.55;
const FANTASYPROS_WEIGHT = 0.45;

const teamCodes = [
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAC",
  "JAX",
  "KC",
  "LV",
  "LAC",
  "LAR",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WAS"
];

function normalizeTeam(team) {
  if (team === "JAC") return "JAX";
  if (team === "LVR") return "LV";
  return team;
}

function parseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "—") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
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

function toId(name, position, team) {
  return `${name}-${position}-${team}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadFantasyProsPlayers(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(splitCsvLine)
    .map((cells) => {
      const rank = parseNumber(cells[0]);
      const tier = parseNumber(cells[1]);
      const name = cells[2];
      const team = normalizeTeam(cells[3]);
      const posText = cells[4] || "";
      let position = posText.replace(/\d+$/g, "");
      if (position === "DST") position = "DEF";
      const positionalRank = parseNumber(posText.replace(/^\D+/g, ""));
      const bye = parseNumber(cells[5]);
      const ecrVsAdp = parseNumber(String(cells[9] ?? "").replace(/[^+\-0-9]/g, "")) ?? 0;

      if (!rank || !name || !position || position === "K") return null;

      return {
        id: toId(name, position, team),
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

function loadBeatAdpRows(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .map((cells) => {
      const rawPlayer = cells[1] || "";
      const team = teamCodes.find((code) => rawPlayer.endsWith(code));
      const name = team ? rawPlayer.slice(0, -team.length) : rawPlayer;

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

function loadDraftSharksRows(filePath) {
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(splitCsvLine)
    .map((cells) => {
      const rank = parseNumber(cells[0]);
      const team = normalizeTeam(cells[1]);
      const name = cells[2];
      const position = cells[3] === "DST" ? "DEF" : cells[3];

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

function applyCompositeRanks(players) {
  const positionCounts = {};
  return players
    .sort((a, b) => a.compositeRank - b.compositeRank)
    .map((player, index) => {
      positionCounts[player.position] = (positionCounts[player.position] ?? 0) + 1;
      return {
        ...player,
        rank: index + 1,
        positionalRank: positionCounts[player.position]
      };
    });
}

const fantasyProsPlayers = loadFantasyProsPlayers(fantasyProsPath);
const beatAdpRows = loadBeatAdpRows(beatAdpPath);
const draftSharksRows = loadDraftSharksRows(draftSharksPath);
const beatAdpByKey = new Map(beatAdpRows.map((row) => [playerKey(row.name, row.team), row]));
const draftSharksByKey = new Map(draftSharksRows.map((row) => [playerKey(row.name, row.team), row]));

let matched = 0;
let draftSharksMatched = 0;
const mergedPlayers = fantasyProsPlayers.map((player) => {
  const beatAdp = beatAdpByKey.get(playerKey(player.name, player.team));
  const draftSharks = draftSharksByKey.get(playerKey(player.name, player.team));

  if (beatAdp) matched += 1;
  if (draftSharks) draftSharksMatched += 1;
  const preferredAdp =
    beatAdp?.yahooAdp ??
    beatAdp?.consensusAdp ??
    beatAdp?.sleeperAdp ??
    beatAdp?.espnAdp ??
    player.adp;
  const compositeRank = draftSharks
    ? (draftSharks.draftSharksRank * DRAFT_SHARKS_WEIGHT) + (player.rank * FANTASYPROS_WEIGHT)
    : player.rank;

  return {
    ...player,
    fantasyProsRank: player.rank,
    compositeRank,
    adp: preferredAdp,
    beatAdpRank: beatAdp?.beatAdpRank,
    consensusAdp: beatAdp?.consensusAdp,
    sleeperAdp: beatAdp?.sleeperAdp,
    espnAdp: beatAdp?.espnAdp,
    yahooAdp: beatAdp?.yahooAdp,
    underdogAdp: beatAdp?.underdogAdp,
    fantasyProsAdp: beatAdp?.fantasyProsAdp,
    draftSharksRank: draftSharks?.draftSharksRank,
    draftSharksAdp: draftSharks?.draftSharksAdp,
    draftSharksGames: draftSharks?.draftSharksGames,
    draftSharksBye: draftSharks?.draftSharksBye,
    draftSharksSos: draftSharks?.draftSharksSos,
    draftSharksInjuryRisk: draftSharks?.draftSharksInjuryRisk,
    draftSharksFloor: draftSharks?.draftSharksFloor,
    draftSharksConsensusProjection: draftSharks?.draftSharksConsensusProjection,
    draftSharksProjection: draftSharks?.draftSharksProjection,
    draftSharksCeiling: draftSharks?.draftSharksCeiling,
    draftSharks3dValue: draftSharks?.draftSharks3dValue
  };
});
const rankedPlayers = applyCompositeRanks(mergedPlayers);

fs.writeFileSync(
  outputPath,
  `export const fantasyProsPlayers = ${JSON.stringify(rankedPlayers, null, 2)};\n`,
  "utf8"
);

const fantasyProsKeys = new Set(fantasyProsPlayers.map((player) => playerKey(player.name, player.team)));
const unmatchedSample = beatAdpRows
  .filter((row) => !fantasyProsKeys.has(playerKey(row.name, row.team)))
  .slice(0, 15);

console.log(
  JSON.stringify(
    {
      output: path.resolve(outputPath),
      fantasyProsPlayers: fantasyProsPlayers.length,
      beatAdpRows: beatAdpRows.length,
      draftSharksRows: draftSharksRows.length,
      matched,
      draftSharksMatched,
      unmatchedSample
    },
    null,
    2
  )
);
