import { leagueSettings, teamNames } from "./data/leagueSettings.js";
import { fantasyProsPlayers } from "./data/fantasyProsPlayers.js";
import { buildRoster, getMyUpcomingPicks, getPickInfo, getRosterCount, getRosterNeeds, getTotalPicks, TOTAL_ROUNDS } from "./logic/draft.js";
import { getAvailablePlayers, getStackFit, recommendPlayers } from "./logic/recommendations.js";

const STORAGE_KEY = "ward19-draft-assistant-state-v1";
const BOARD_LIMIT = 220;
const app = document.querySelector("#app");

let state = loadState();

function defaultState() {
  return {
    mySlot: null,
    picks: [],
    search: "",
    editPickIndex: null,
    editSearch: "",
    positionFilter: "ALL",
    activeView: "draft"
  };
}

function loadState() {
  try {
    return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setState(nextState) {
  state = { ...state, ...nextState };
  saveState();
  render();
}

function draftPlayer(playerId) {
  const player = fantasyProsPlayers.find((candidate) => candidate.id === playerId);
  if (!player) return;
  const pickInfo = getPickInfo(state.picks.length + 1);
  setState({
    picks: [...state.picks, { ...pickInfo, player }],
    search: "",
    editPickIndex: null,
    editSearch: ""
  });
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

    const available = getAvailablePlayers(fantasyProsPlayers, picks);
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
  const player = fantasyProsPlayers.find((candidate) => candidate.id === playerId);
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

function resetDraft() {
  if (!confirm("Reset all draft picks?")) return;
  setState({ ...defaultState(), mySlot: state.mySlot });
}

function getCurrentContext() {
  const currentPick = state.picks.length + 1;
  const totalPicks = getTotalPicks();
  const currentInfo = getPickInfo(Math.min(currentPick, totalPicks));
  const myRoster = state.mySlot ? buildRoster(state.picks, state.mySlot) : buildRoster([], 1);
  const recommendations = recommendPlayers(fantasyProsPlayers, state.picks, myRoster, currentPick);
  const available = getAvailablePlayers(fantasyProsPlayers, state.picks);
  const upcoming = getMyUpcomingPicks(currentPick, state.mySlot);
  return { currentPick, totalPicks, currentInfo, myRoster, recommendations, available, upcoming };
}

function render() {
  const ctx = getCurrentContext();
  app.innerHTML = `
    <main class="shell">
      ${renderHeader(ctx)}
      ${renderSetup()}
      ${renderTabs()}
      <section class="view">
        ${state.activeView === "draft" ? renderDraftView(ctx) : ""}
        ${state.activeView === "available" ? renderAvailableView(ctx) : ""}
        ${state.activeView === "roster" ? renderRosterView(ctx) : ""}
        ${state.activeView === "recap" ? renderRecapView(ctx) : ""}
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
        <small>${teamNames[ctx.currentInfo.teamSlot - 1]} - ${nextPickText}</small>
      </div>
    </header>
  `;
}

function renderSetup() {
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
      <div class="league-chip">${leagueSettings.teams} teams - ${TOTAL_ROUNDS} rounds - No K</div>
    </section>
  `;
}

function renderTabs() {
  const tabs = [
    ["draft", "Draft"],
    ["available", "Available"],
    ["roster", "Roster"],
    ["recap", "Recap"],
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
    ${renderDraftPulse(ctx)}
    ${renderRecommendations(ctx)}
    ${renderLikelyGone(ctx)}
    ${renderSearch(ctx)}
    ${renderRecentPicks()}
    ${renderCorrectionPanel(ctx)}
  `;
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
        ${ctx.recommendations.slice(0, 5).map((player, index) => renderPlayerRow(player, index === 0 ? "Best pick" : player.reason, true, ctx.currentPick)).join("")}
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

function renderTeamsView() {
  return `
    <section class="teams-grid">
      ${teamNames.map((name, index) => {
        const teamSlot = index + 1;
        const picks = state.picks.filter((pick) => pick.teamSlot === teamSlot);
        return `
          <article class="team-card ${state.mySlot === teamSlot ? "mine" : ""}">
            <h2>${state.mySlot === teamSlot ? "My Team" : name}</h2>
            ${picks.length ? picks.map((pick) => `<p>${pick.player.name} <span>${pick.player.position}</span></p>`).join("") : "<p class='empty'>No picks yet</p>"}
          </article>
        `;
      }).join("")}
    </section>
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
          <em>${pick.player.position} - ${teamNames[pick.teamSlot - 1]}${pick.mocked ? " - mocked" : ""}</em>
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
        <span>${teamNames[pick.teamSlot - 1]}</span>
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

function renderPlayerRow(player, meta, canDraft, currentPick = state.picks.length + 1) {
  return `
    <button class="player-row" ${canDraft ? `data-draft="${player.id}"` : ""}>
      <span class="rank">${player.rank}</span>
      <span class="player-main">
        <strong>${player.name}</strong>
        <em>${player.position} - ${player.team} - Tier ${player.tier}</em>
        <span class="player-stats">
          <span>Rank ${player.rank}</span>
          <span>ADP ${formatAdp(player.adp)}</span>
          <span class="${getValueClass(player, currentPick)}">${formatValue(player, currentPick)}</span>
        </span>
      </span>
      <span class="meta">${meta}</span>
    </button>
  `;
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
  const nextSteps = getRecapNextSteps(needs, positionCounts, myPicks.length);
  const identity = getBuildIdentity(myPicks, roster, positionCounts);
  const gradeScore = getRecapScore(needs, values, reaches, myPicks.length);

  return {
    grade: getRecapGrade(gradeScore),
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

function getRecapNextSteps(needs, counts, pickCount) {
  const steps = [];
  if (needs.DEF > 0 && leagueSettings.draftRounds - pickCount <= 3) steps.push("Plan DEF before the final pick window closes.");
  if (needs.QB > 0 && pickCount >= 9) steps.push("QB is still open. Stop waiting unless value is ugly.");
  if (needs.TE > 0 && pickCount >= 8) steps.push("TE is still open. Look for value or a safe floor soon.");
  if (needs.WR > 0) steps.push(`${needs.WR} WR starter slot${needs.WR > 1 ? "s" : ""} still open.`);
  if (counts.RB < 3 && pickCount >= 8) steps.push("RB depth is thin for bye weeks and injuries.");
  if (counts.WR < 4 && pickCount >= 8) steps.push("WR depth is thin for a 3-WR full PPR league.");
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
  if (counts.WR >= counts.RB + 2) identity.push("Leaning into receiver depth.");
  if (counts.RB >= counts.WR + 2) identity.push("Leaning into running back depth.");

  return identity.slice(0, 3);
}

function getRecapScore(needs, values, reaches, pickCount) {
  let score = 78;
  score += Math.min(values.length * 5, 12);
  score -= Math.min(reaches.length * 4, 10);
  if (needs.WR > 0 && pickCount >= 8) score -= 8;
  if (needs.RB > 0 && pickCount >= 8) score -= 7;
  if (needs.QB > 0 && pickCount >= 10) score -= 6;
  if (needs.TE > 0 && pickCount >= 10) score -= 5;
  if (needs.DEF > 0 && leagueSettings.draftRounds - pickCount <= 2) score -= 5;
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

  return [...available]
    .map((player) => ({ player, score: getMockDraftScore(player, needs, pickInfo) }))
    .sort((a, b) => b.score - a.score)[0]?.player;
}

function getMockDraftScore(player, needs, pickInfo) {
  const adp = Number(player.adp);
  const marketPick = Number.isFinite(adp) && adp <= leagueSettings.teams * leagueSettings.draftRounds + 12 ? adp : player.rank;
  const round = pickInfo.round;
  let score = 500 - marketPick;

  if (needs[player.position] > 0) score += 18;
  if (["RB", "WR", "TE"].includes(player.position) && needs.FLEX > 0) score += 8;
  if (player.position === "WR") score += 5;
  if (player.position === "QB" && needs.QB <= 0) score -= 90;
  if (player.position === "QB" && round <= 3) score -= 16;
  if (player.position === "DEF" && needs.DEF <= 0) score -= 120;
  if (player.position === "DEF" && round < 13) score -= 180;
  if (needs.BENCH <= 0 && needs[player.position] <= 0) score -= 80;
  if (fillsMockRequiredSlot(player, needs) && getMockRemainingRosterPicks(needs) <= getMockRequiredOpenSlots(needs)) score += 210;
  if (player.position === "DEF" && needs.DEF > 0 && round >= 14) score += 260;

  return score;
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

function bindEvents() {
  app.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("click", () => setState({ mySlot: Number(button.dataset.slot) }));
  });

  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setState({ activeView: button.dataset.view }));
  });

  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => setState({ positionFilter: button.dataset.filter }));
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

  app.querySelector("[data-action='undo']")?.addEventListener("click", undoPick);
  app.querySelector("[data-action='reset']")?.addEventListener("click", resetDraft);
  app.querySelector("[data-action='cancel-edit']")?.addEventListener("click", cancelEditPick);
  app.querySelector("[data-action='mock-next']")?.addEventListener("click", autoDraftNextPick);
  app.querySelector("[data-action='mock-to-me']")?.addEventListener("click", autoDraftToMyPick);
  app.querySelector("[data-input='search']")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    saveState();
    render();
    app.querySelector("[data-input='search']")?.focus();
  });
  app.querySelector("[data-input='edit-search']")?.addEventListener("input", (event) => {
    state.editSearch = event.target.value;
    saveState();
    render();
    app.querySelector("[data-input='edit-search']")?.focus();
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
