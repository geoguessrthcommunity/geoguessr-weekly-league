// ====================================================================
// GeoGuessr Weekly Challenge - Frontend App Logic
// Pure English UI (Rules tab is Bilingual English + Thai)
// ====================================================================

let db = null;
let allWeeks = [];
let currentWeek = null;
let currentChallenges = [];
let currentCalculatedData = null;
let seasonStandingsCache = null;

let currentMainView = "leaderboard"; // "leaderboard" | "raw"
let selectedRawSeed = 1; // 1 to 7

let realtimeChannel = null;
let realtimeDebounceTimer = null;

if (CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
  db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

// DOM Elements
const bannerTitle = document.getElementById("bannerTitle");
const bannerSubInfo = document.getElementById("bannerSubInfo");
const countdownBadge = document.getElementById("countdownBadge");
const topSection = document.getElementById("topSection");
const lastUpdateText = document.getElementById("lastUpdateText");
const mapsGrid = document.getElementById("mapsGrid");
const tableTopHeaderRow = document.getElementById("tableTopHeaderRow");
const tableSubHeaderRow = document.getElementById("tableSubHeaderRow");
const scoresTableBody = document.getElementById("scoresTableBody");
const excelTabsList = document.getElementById("excelTabsList");
const rulesView = document.getElementById("rulesView");
const seasonView = document.getElementById("seasonView");

// View Switcher Elements
const viewSwitchBar = document.getElementById("viewSwitchBar");
const viewBtnLeaderboard = document.getElementById("viewBtnLeaderboard");
const viewBtnRaw = document.getElementById("viewBtnRaw");
const leaderboardView = document.getElementById("leaderboardView");
const rawScoresView = document.getElementById("rawScoresView");
const rawMapSelectorPills = document.getElementById("rawMapSelectorPills");
const rawTableBody = document.getElementById("rawTableBody");

const formatNum = (num) => (num !== undefined && num !== null ? Number(num).toLocaleString() : "-");

function formatRankDisplay(rank) {
  if (rank === 1) return `🥇 1`;
  if (rank === 2) return `🥈 2`;
  if (rank === 3) return `🥉 3`;
  return `${rank}`;
}

/**
 * 1. Initialize and fetch all weeks
 */
async function init() {
  if (!db) {
    scoresTableBody.innerHTML = `
      <tr>
        <td colspan="17" style="padding: 30px; text-align: center; color: #dc2626;">
          ⚠️ Please configure <strong>SUPABASE_URL</strong> and <strong>SUPABASE_ANON_KEY</strong> in <code>config.js</code>
        </td>
      </tr>`;
    return;
  }

  try {
    const { data: weeks, error } = await db
      .from("weeks")
      .select("*")
      .order("id", { ascending: false });

    if (error || !weeks || weeks.length === 0) {
      scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 30px; text-align: center;">No competition data available yet.</td></tr>`;
      return;
    }

    allWeeks = weeks;
    renderBottomTabs();

    const defaultWeek = weeks.find((w) => w.is_active) || weeks[0];
    await selectWeek(defaultWeek.id);

    // Setup Supabase Realtime Listener (debounced)
    setupRealtime();

    // Restore saved rules language preference if any
    try {
      const savedLang = localStorage.getItem("rules_lang");
      if (savedLang === "en") {
        setRulesLang("en");
      }
    } catch (e) {}
  } catch (err) {
    console.error("Init Error:", err);
  }
}

/**
 * 2. Render bottom tabs (Excel / Google Sheets style)
 */
function renderBottomTabs() {
  const tabsHtml = allWeeks
    .map(
      (w) => `
      <div id="tab-week-${w.id}" class="excel-tab ${currentWeek?.id === w.id ? "active" : ""}" onclick="selectWeek(${w.id})">
        ${w.is_frozen ? "❄️" : "🟢"} ${escapeHtml(w.title)}
      </div>
    `
    )
    .join("");

  const rulesTab = document.getElementById("tabRules");
  const seasonTab = document.getElementById("tabSeason");
  excelTabsList.innerHTML = "";
  if (rulesTab) excelTabsList.appendChild(rulesTab);
  if (seasonTab) excelTabsList.appendChild(seasonTab);
  excelTabsList.insertAdjacentHTML("beforeend", tabsHtml);
}

/**
 * 3. Select and load a week
 */
async function selectWeek(weekId) {
  document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));
  const targetTab = document.getElementById(`tab-week-${weekId}`);
  if (targetTab) targetTab.classList.add("active");

  // Show Top Section (Logo + 7 Map Cards) when viewing a week
  if (topSection) topSection.style.display = "grid";
  if (rulesView) rulesView.style.display = "none";
  if (seasonView) seasonView.style.display = "none";

  scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">Loading data and calculating scores...</td></tr>`;

  const { data: week } = await db.from("weeks").select("*").eq("id", weekId).single();
  if (!week) return;
  currentWeek = week;

  // Header Banner Info
  bannerTitle.textContent = `🏆 ${week.title}`;
  bannerSubInfo.textContent = week.header_info || (week.is_frozen ? "❄️ Competition Ended" : "🟢 Ongoing (Auto-updates every 30m)");

  const updateDate = week.updated_at ? new Date(week.updated_at) : new Date();
  lastUpdateText.textContent = `${updateDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${updateDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

  // Start live countdown timer for this week
  startCountdown(week.end_date, week.is_frozen);

  // Show or hide View Switcher based on week status
  if (week.is_frozen) {
    viewSwitchBar.style.display = "flex";
  } else {
    viewSwitchBar.style.display = "none";
    currentMainView = "leaderboard";
  }

  // Load Challenges (7 Seeds)
  const { data: challenges } = await db
    .from("challenges")
    .select("*")
    .eq("week_id", weekId)
    .order("seed_number", { ascending: true });

  currentChallenges = challenges || [];
  renderMapCards(currentChallenges);
  renderTableHeaders(currentChallenges);

  if (currentChallenges.length === 0) {
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 30px; text-align: center;">No maps found for this week.</td></tr>`;
    return;
  }

  // Load Scores
  const challengeIds = currentChallenges.map((c) => c.id);
  const { data: scores } = await db
    .from("scores")
    .select("*, players(id, username)")
    .in("challenge_id", challengeIds);

  calculateAndRenderScores(scores || [], currentChallenges);

  switchMainView(currentMainView);
}

/**
 * 4. Switch between Leaderboard and Raw Scores View
 */
window.switchMainView = function (viewName) {
  if (!currentWeek?.is_frozen) {
    viewName = "leaderboard";
  }

  currentMainView = viewName;
  if (rulesView) rulesView.style.display = "none";
  if (seasonView) seasonView.style.display = "none";
  if (topSection) topSection.style.display = "grid";

  if (viewName === "leaderboard") {
    viewBtnLeaderboard.classList.add("active");
    viewBtnRaw.classList.remove("active");
    leaderboardView.style.display = "block";
    rawScoresView.style.display = "none";
  } else if (viewName === "raw") {
    viewBtnLeaderboard.classList.remove("active");
    viewBtnRaw.classList.add("active");
    leaderboardView.style.display = "none";
    rawScoresView.style.display = "block";
    renderRawScoresView();
  }
};

/**
 * 5. Switch to Rules View or Season Standings View
 */
window.switchTab = function (tabName) {
  document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));

  if (tabName === "rules") {
    document.getElementById("tabRules")?.classList.add("active");

    leaderboardView.style.display = "none";
    rawScoresView.style.display = "none";
    viewSwitchBar.style.display = "none";
    if (seasonView) seasonView.style.display = "none";
    if (topSection) topSection.style.display = "none";

    bannerTitle.textContent = "📜 Rules & Scoring / กฎและกติกาการแข่งขัน";
    bannerSubInfo.textContent = "Season 1 (Nov 14, 2026 – Jan 1, 2027)";

    if (countdownBadge) countdownBadge.style.display = "none";
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    rulesView.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (tabName === "season") {
    document.getElementById("tabSeason")?.classList.add("active");

    leaderboardView.style.display = "none";
    rawScoresView.style.display = "none";
    viewSwitchBar.style.display = "none";
    rulesView.style.display = "none";
    if (topSection) topSection.style.display = "none";

    bannerTitle.textContent = "🏆 Season 1 Standings";
    bannerSubInfo.textContent = "Cumulative points from frozen weeks (Section 6 Rules)";

    if (countdownBadge) countdownBadge.style.display = "none";
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    if (seasonView) seasonView.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
    loadAndRenderSeasonStandings();
  }
};

/**
 * Live Countdown Timer for playing deadline
 */
let countdownInterval = null;

function startCountdown(endDateStr, isFrozen) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  if (!countdownBadge) return;

  if (isFrozen) {
    countdownBadge.className = "countdown-badge frozen";
    countdownBadge.innerHTML = `❄️ Ended`;
    countdownBadge.style.display = "inline-flex";
    return;
  }

  if (!endDateStr) {
    countdownBadge.style.display = "none";
    return;
  }

  function updateTimer() {
    const endMs = new Date(endDateStr).getTime();
    const nowMs = Date.now();
    const diff = endMs - nowMs;

    if (diff <= 0) {
      countdownBadge.className = "countdown-badge frozen";
      countdownBadge.innerHTML = `⌛ Time's Up`;
      countdownBadge.style.display = "inline-flex";
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    countdownBadge.className = "countdown-badge";
    if (days > 0) {
      countdownBadge.innerHTML = `⏳ <strong>${days}d ${hours}h ${minutes}m</strong> left`;
    } else {
      countdownBadge.innerHTML = `⏳ <strong>${hours}h ${minutes}m ${seconds}s</strong> left`;
    }
    countdownBadge.style.display = "inline-flex";
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

/**
 * 5.1 Toggle Rules Language between Thai ('th') and English ('en')
 */
window.setRulesLang = function (lang) {
  const btnTh = document.getElementById("btnRulesTh");
  const btnEn = document.getElementById("btnRulesEn");
  const rulesTh = document.getElementById("rulesContentTh");
  const rulesEn = document.getElementById("rulesContentEn");

  if (!rulesTh || !rulesEn) return;

  if (lang === "en") {
    rulesTh.style.display = "none";
    rulesEn.style.display = "block";
    btnEn?.classList.add("active");
    btnTh?.classList.remove("active");
    try {
      localStorage.setItem("rules_lang", "en");
    } catch (e) {}
  } else {
    rulesTh.style.display = "block";
    rulesEn.style.display = "none";
    btnTh?.classList.add("active");
    btnEn?.classList.remove("active");
    try {
      localStorage.setItem("rules_lang", "th");
    } catch (e) {}
  }
};

/**
 * 6. Render the 7 Map Cards
 */
function renderMapCards(challenges) {
  if (!challenges.length) {
    mapsGrid.innerHTML = `<div style="grid-column: span 7; color: white; text-align: center;">No map data available</div>`;
    return;
  }

  mapsGrid.innerHTML = challenges
    .map((c) => {
      return `
      <div class="map-card">
        <div>
          <div class="map-title">Map ${c.seed_number}</div>
          <div class="map-desc">${renderFlags(escapeHtml(c.name || `Seed ${c.seed_number}`))}</div>
        </div>
        <a href="${c.url}" target="_blank" rel="noopener noreferrer" class="map-btn">
          ▶ Play Challenge
        </a>
      </div>
    `;
    })
    .join("");
}

/**
 * 7. Render Table Headers
 */
function renderTableHeaders(challenges) {
  tableTopHeaderRow.innerHTML = `
    <th class="col-pos" rowspan="2">Position</th>
    <th class="col-player" rowspan="2">Pseudo</th>
    <th class="col-total" rowspan="2">Points</th>
  `;
  tableSubHeaderRow.innerHTML = ``;

  challenges.forEach((c) => {
    const thTop = document.createElement("th");
    thTop.colSpan = 2;
    thTop.className = `th-top-map m${c.seed_number}`;
    thTop.textContent = `Map ${c.seed_number}`;
    tableTopHeaderRow.appendChild(thTop);

    tableSubHeaderRow.insertAdjacentHTML(
      "beforeend",
      `
      <th class="th-sub col-pts">Points</th>
      <th class="th-sub col-rank">Rank</th>
    `
    );
  });
}

/**
 * 8. Reusable Week Calculation (Phantom Score 10% Threshold Algorithm)
 */
function computeWeekStandings(challenges, scores) {
  const playersByMap = new Map();
  const allPlayerIds = new Set();
  const playerNames = new Map();

  challenges.forEach((c) => playersByMap.set(c.id, []));

  scores.forEach((s) => {
    const chId = s.challenge_id;
    const uId = s.player_id;
    const uName = s.players?.username || "Unknown";

    allPlayerIds.add(uId);
    playerNames.set(uId, uName);

    if (playersByMap.has(chId)) {
      playersByMap.get(chId).push({
        userId: uId,
        username: uName,
        raw: [s.r1, s.r2, s.r3, s.r4, s.r5, s.total_score],
      });
    }
  });

  const mapResults = new Map();

  challenges.forEach((c) => {
    const pList = playersByMap.get(c.id) || [];
    const resultMap = new Map();

    if (pList.length > 0) {
      // 1. Calculate Phantom Score for each of 6 rounds (0..4 = R1..R5 / 5 = Total)
      for (let m = 0; m < 6; m++) {
        const maxScore = m < 5 ? 5000 : 25000;
        const colRawScores = pList.map((p) => p.raw[m]);

        pList.forEach((p) => {
          p.points = p.points || [];
          p.phantoms = p.phantoms || [];

          const raw = p.raw[m];
          const missing = Math.max(0, maxScore - raw);
          const phantom = raw + 0.1 * missing;

          p.phantoms[m] = phantom;
          const ptsInRound = colRawScores.filter((s) => s <= phantom).length;
          p.points[m] = ptsInRound;
        });
      }

      // 2. Map Points = direct sum of points earned in all 6 rounds
      pList.forEach((p) => {
        p.ptsRounds = p.points.reduce((a, b) => a + b, 0);
        p.ptsMap = p.ptsRounds;
      });

      // 3. Rank in map (ptsMap descending, raw total as tie breaker)
      pList.sort((a, b) => b.ptsMap - a.ptsMap || b.raw[5] - a.raw[5]);

      pList.forEach((p, idx) => {
        const isTie = idx > 0 && pList[idx - 1].ptsMap === p.ptsMap;
        p.mapRank = isTie ? pList[idx - 1].mapRank : idx + 1;

        resultMap.set(p.userId, {
          userId: p.userId,
          username: p.username,
          ptsMap: p.ptsMap,
          rank: p.mapRank,
          raw: p.raw,
          phantoms: p.phantoms,
          points: p.points,
          ptsRounds: p.ptsRounds,
        });
      });
    }

    mapResults.set(c.id, resultMap);
  });

  // Grand Total across all challenges in this week
  const leaderboard = [];

  allPlayerIds.forEach((uId) => {
    let grandTotal = 0;
    const playerMapStats = {};

    challenges.forEach((c) => {
      const res = mapResults.get(c.id)?.get(uId);
      if (res) {
        grandTotal += res.ptsMap;
        playerMapStats[c.id] = res;
      } else {
        playerMapStats[c.id] = null;
      }
    });

    leaderboard.push({
      userId: uId,
      username: playerNames.get(uId) || "Unknown",
      grandTotal,
      maps: playerMapStats,
    });
  });

  // Sort overall standings (descending)
  leaderboard.sort((a, b) => b.grandTotal - a.grandTotal);

  for (let i = 0; i < leaderboard.length; i++) {
    if (i > 0 && leaderboard[i].grandTotal === leaderboard[i - 1].grandTotal) {
      leaderboard[i].overallRank = leaderboard[i - 1].overallRank;
    } else {
      leaderboard[i].overallRank = i + 1;
    }
  }

  return { leaderboard, mapResults, playerNames };
}

/**
 * 8.1 Calculate and render Main Leaderboard Table for Current Week
 */
function calculateAndRenderScores(scores, challenges) {
  const { leaderboard, mapResults, playerNames } = computeWeekStandings(challenges, scores);

  currentCalculatedData = { mapResults, challenges, playerNames, leaderboard };

  if (leaderboard.length === 0) {
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">No players have completed 5 rounds in this week yet.</td></tr>`;
    return;
  }

  scoresTableBody.innerHTML = leaderboard
    .map((p) => {
      const posDisplay = formatRankDisplay(p.overallRank);

      // Count played maps out of total challenges
      const playedMapsCount = challenges.filter((c) => p.maps[c.id]).length;
      const totalMapsCount = challenges.length || 7;
      const badgeCls = playedMapsCount === totalMapsCount ? "played-badge complete" : "played-badge";
      const playedBadge = `<span class="${badgeCls}" title="Completed ${playedMapsCount} of ${totalMapsCount} maps">[${playedMapsCount}/${totalMapsCount}]</span>`;

      const mapCols = challenges
        .map((c) => {
          const mData = p.maps[c.id];
          if (!mData) {
            return `
              <td class="col-pts" style="color: #cbd5e1;">-</td>
              <td class="col-rank" style="color: #cbd5e1;">-</td>
            `;
          }

          const rankDisplay = formatRankDisplay(mData.rank);

          return `
            <td class="col-pts">${formatNum(mData.ptsMap)}</td>
            <td class="col-rank">${rankDisplay}</td>
          `;
        })
        .join("");

      return `
        <tr>
          <td class="col-pos">${posDisplay}</td>
          <td class="col-player" title="${escapeHtml(p.username)}">
            <a class="player-link" onclick="openPlayerProfile('${p.userId}')" title="Click to view player profile">${escapeHtml(p.username)}</a>${playedBadge}
          </td>
          <td class="col-total">${formatNum(p.grandTotal)}</td>
          ${mapCols}
        </tr>
      `;
    })
    .join("");

  if (currentMainView === "raw" && currentWeek?.is_frozen) {
    renderRawScoresView();
  }
}

/**
 * 9. Render Raw Scores Table for the selected Map
 */
function renderRawScoresView() {
  if (!currentCalculatedData || !currentChallenges.length) return;

  const { mapResults, challenges } = currentCalculatedData;

  rawMapSelectorPills.innerHTML = challenges
    .map((c) => {
      const isSel = c.seed_number === selectedRawSeed;
      return `
        <button class="raw-map-pill ${isSel ? "active" : ""}" onclick="selectRawMapSeed(${c.seed_number})">
          🗺️ Map ${c.seed_number}: ${renderFlags(escapeHtml(c.name || `Seed ${c.seed_number}`))}
        </button>
      `;
    })
    .join("");

  const activeChallenge = challenges.find((c) => c.seed_number === selectedRawSeed) || challenges[0];
  const resultMap = mapResults.get(activeChallenge.id);

  if (!resultMap || resultMap.size === 0) {
    rawTableBody.innerHTML = `<tr><td colspan="9" style="padding: 30px; text-align: center; color: #64748b;">No players in this map yet.</td></tr>`;
    return;
  }

  const playersList = Array.from(resultMap.values()).sort((a, b) => b.ptsMap - a.ptsMap || b.raw[5] - a.raw[5]);

  rawTableBody.innerHTML = playersList
    .map((p) => {
      const rankDisplay = formatRankDisplay(p.rank);

      const roundCells = [0, 1, 2, 3, 4]
        .map((rIdx) => {
          const rawVal = p.raw[rIdx];
          const ptsVal = p.points[rIdx];
          return `
            <td class="raw-cell">
              <div class="raw-score-val">${formatNum(rawVal)}</div>
              <div class="raw-pts-badge">+${formatNum(ptsVal)} pts</div>
            </td>
          `;
        })
        .join("");

      const totalRaw = p.raw[5];
      const totalPts = p.points[5];
      const totalCell = `
        <td class="raw-cell" style="background: #eff6ff;">
          <div class="raw-score-val" style="color: #1e3a8a;">${formatNum(totalRaw)}</div>
          <div class="raw-pts-badge" style="background: #bfdbfe; color: #1e3a8a;">+${formatNum(totalPts)} pts</div>
        </td>
      `;

      return `
        <tr>
          <td class="col-pos">${rankDisplay}</td>
          <td class="col-player">
            <a class="player-link" onclick="openPlayerProfile('${p.userId}')" title="Click to view player profile">${escapeHtml(p.username)}</a>
          </td>
          ${roundCells}
          ${totalCell}
          <td class="col-total" style="font-size: 1rem; color: #00247d;">${formatNum(p.ptsMap)}</td>
        </tr>
      `;
    })
    .join("");
}

window.selectRawMapSeed = function (seedNum) {
  selectedRawSeed = seedNum;
  renderRawScoresView();
};

/**
 * 10. Season Points Formula (Section 6 Rules)
 * Rank 1: N + 5
 * Rank 2: N + 2
 * Rank 3: N - 1
 * Rank 4: N - 3
 * Rank 5: N - 4
 * Rank k (k >= 5): max(1, N - k + 1)
 */
function getSeasonPointsForRank(rank, N) {
  if (!N || N <= 0) return 0;
  if (rank === 1) return N + 5;
  if (rank === 2) return N + 2;
  if (rank === 3) return Math.max(1, N - 1);
  if (rank === 4) return Math.max(1, N - 3);
  if (rank === 5) return Math.max(1, N - 4);
  return Math.max(1, N - rank + 1);
}

/**
 * 11. Load and Render Season Standings
 */
async function loadAndRenderSeasonStandings() {
  if (!db) return;
  const seasonTableBody = document.getElementById("seasonTableBody");
  const seasonTableHeaderRow = document.getElementById("seasonTableHeaderRow");
  const seasonFrozenCountText = document.getElementById("seasonFrozenCountText");

  seasonTableBody.innerHTML = `<tr><td colspan="15" style="padding: 40px; text-align: center; color: #64748b;">Calculating Season Standings...</td></tr>`;

  try {
    const frozenWeeks = allWeeks.filter((w) => w.is_frozen).sort((a, b) => a.id - b.id);

    if (seasonFrozenCountText) {
      seasonFrozenCountText.textContent = `Frozen Weeks: ${frozenWeeks.length}`;
    }

    if (frozenWeeks.length === 0) {
      seasonTableHeaderRow.innerHTML = `
        <th class="col-pos">Position</th>
        <th class="col-player">Pseudo</th>
        <th class="col-total">Season Points</th>
      `;
      seasonTableBody.innerHTML = `
        <tr>
          <td colspan="3" style="padding: 40px; text-align: center; color: #64748b;">
            ❄️ No weeks have been frozen yet.<br>
            Season points will be calculated as soon as a competition week concludes and is frozen.
          </td>
        </tr>`;
      return;
    }

    const frozenWeekIds = frozenWeeks.map((w) => w.id);
    const { data: challenges, error: chErr } = await db
      .from("challenges")
      .select("*")
      .in("week_id", frozenWeekIds)
      .order("seed_number", { ascending: true });

    if (chErr) throw chErr;

    const chIds = (challenges || []).map((c) => c.id);
    const { data: scores, error: scErr } = await db
      .from("scores")
      .select("*, players(id, username)")
      .in("challenge_id", chIds);

    if (scErr) throw scErr;

    const weeklyStandingsMap = new Map();
    const playerCumulative = new Map();

    frozenWeeks.forEach((w) => {
      const wChallenges = (challenges || []).filter((c) => c.week_id === w.id);
      const wChIds = new Set(wChallenges.map((c) => c.id));
      const wScores = (scores || []).filter((s) => wChIds.has(s.challenge_id));

      const { leaderboard } = computeWeekStandings(wChallenges, wScores);
      const N = leaderboard.length;

      leaderboard.forEach((p) => {
        const seasonPts = getSeasonPointsForRank(p.overallRank, N);

        if (!playerCumulative.has(p.userId)) {
          playerCumulative.set(p.userId, {
            userId: p.userId,
            username: p.username,
            totalSeasonPts: 0,
            weekStats: {},
            podiums: { gold: 0, silver: 0, bronze: 0 },
            weeksPlayed: 0,
          });
        }

        const cp = playerCumulative.get(p.userId);
        cp.totalSeasonPts += seasonPts;
        cp.weeksPlayed += 1;
        cp.weekStats[w.id] = {
          pts: seasonPts,
          rank: p.overallRank,
          grandTotal: p.grandTotal,
        };

        if (p.overallRank === 1) cp.podiums.gold++;
        else if (p.overallRank === 2) cp.podiums.silver++;
        else if (p.overallRank === 3) cp.podiums.bronze++;
      });

      weeklyStandingsMap.set(w.id, { leaderboard, N });
    });

    const finalSeasonList = Array.from(playerCumulative.values()).sort(
      (a, b) => b.totalSeasonPts - a.totalSeasonPts
    );

    for (let i = 0; i < finalSeasonList.length; i++) {
      if (i > 0 && finalSeasonList[i].totalSeasonPts === finalSeasonList[i - 1].totalSeasonPts) {
        finalSeasonList[i].seasonRank = finalSeasonList[i - 1].seasonRank;
      } else {
        finalSeasonList[i].seasonRank = i + 1;
      }
    }

    seasonStandingsCache = { finalSeasonList, frozenWeeks, weeklyStandingsMap };

    const weekHeadersHtml = frozenWeeks
      .map((w) => `<th class="th-top-map" style="font-size: 0.85rem;">${escapeHtml(w.title)}</th>`)
      .join("");

    seasonTableHeaderRow.innerHTML = `
      <th class="col-pos">Position</th>
      <th class="col-player">Pseudo</th>
      <th class="col-total">Season Points</th>
      ${weekHeadersHtml}
    `;

    if (finalSeasonList.length === 0) {
      seasonTableBody.innerHTML = `<tr><td colspan="${3 + frozenWeeks.length}" style="padding: 30px; text-align: center;">No player data available.</td></tr>`;
      return;
    }

    seasonTableBody.innerHTML = finalSeasonList
      .map((p) => {
        const posDisplay = formatRankDisplay(p.seasonRank);

        const weekCols = frozenWeeks
          .map((w) => {
            const st = p.weekStats[w.id];
            if (!st) {
              return `<td class="col-pts" style="color: #94a3b8;">-</td>`;
            }
            return `
              <td class="col-pts" style="text-align: center;">
                <div style="font-weight: 700; color: #00247d;">+${formatNum(st.pts)}</div>
                <div style="font-size: 0.72rem; color: #64748b;">${formatRankDisplay(st.rank)}</div>
              </td>
            `;
          })
          .join("");

        return `
          <tr>
            <td class="col-pos">${posDisplay}</td>
            <td class="col-player">
              <a class="player-link" onclick="openPlayerProfile('${p.userId}')" title="Click to view profile">${escapeHtml(p.username)}</a>
            </td>
            <td class="col-total" style="font-size: 1.05rem; color: #00247d;">${formatNum(p.totalSeasonPts)}</td>
            ${weekCols}
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Season calculation error:", err);
    seasonTableBody.innerHTML = `<tr><td colspan="10" style="padding: 30px; text-align: center; color: #dc2626;">Error loading season standings: ${escapeHtml(err.message)}</td></tr>`;
  }
}

/**
 * 12. Player Profile Modal
 */
window.openPlayerProfile = async function (userId) {
  if (!db) return;

  const modal = document.getElementById("playerProfileModal");
  const modalPlayerUsername = document.getElementById("modalPlayerUsername");
  const modalGeoguessrLink = document.getElementById("modalGeoguessrLink");
  const modalPlayerIdSub = document.getElementById("modalPlayerIdSub");
  const statSeasonPts = document.getElementById("statSeasonPts");
  const statWeeksPlayed = document.getElementById("statWeeksPlayed");
  const statPodiums = document.getElementById("statPodiums");
  const stat5kRounds = document.getElementById("stat5kRounds");
  const stat25kGames = document.getElementById("stat25kGames");
  const modalHistoryTableBody = document.getElementById("modalHistoryTableBody");

  modalPlayerUsername.textContent = "Loading Profile...";
  modalPlayerIdSub.textContent = `User ID: ${userId}`;
  modalGeoguessrLink.href = `https://www.geoguessr.com/user/${userId}`;
  modalHistoryTableBody.innerHTML = `<tr><td colspan="11" style="padding: 24px; text-align: center; color: #64748b;">Loading player stats...</td></tr>`;

  modal.classList.add("open");

  try {
    const { data: scores, error: scErr } = await db
      .from("scores")
      .select("*, challenges(*, weeks(*)), players(username)")
      .eq("player_id", userId);

    if (scErr) throw scErr;

    const userScores = scores || [];
    const username = userScores[0]?.players?.username || "Player";
    modalPlayerUsername.textContent = username;

    let count5k = 0;
    let count25k = 0;
    const uniqueWeeks = new Set();

    userScores.forEach((s) => {
      [s.r1, s.r2, s.r3, s.r4, s.r5].forEach((r) => {
        if (r === 5000) count5k++;
      });
      if (s.total_score === 25000) count25k++;
      if (s.challenges?.week_id) uniqueWeeks.add(s.challenges.week_id);
    });

    stat5kRounds.textContent = count5k.toLocaleString();
    stat25kGames.textContent = count25k.toLocaleString();
    statWeeksPlayed.textContent = uniqueWeeks.size.toLocaleString();

    let seasonPts = "-";
    let podiumsStr = "-";
    if (seasonStandingsCache) {
      const pData = seasonStandingsCache.finalSeasonList?.find((p) => p.userId === userId);
      if (pData) {
        seasonPts = formatNum(pData.totalSeasonPts);
        podiumsStr = `${pData.podiums.gold}🥇 ${pData.podiums.silver}🥈 ${pData.podiums.bronze}🥉`;
      }
    }
    statSeasonPts.textContent = seasonPts;
    statPodiums.textContent = podiumsStr;

    if (userScores.length === 0) {
      modalHistoryTableBody.innerHTML = `<tr><td colspan="11" style="padding: 24px; text-align: center;">No recorded games found for this player.</td></tr>`;
      return;
    }

    userScores.sort((a, b) => {
      const wA = a.challenges?.week_id || 0;
      const wB = b.challenges?.week_id || 0;
      if (wB !== wA) return wB - wA;
      return (a.challenges?.seed_number || 0) - (b.challenges?.seed_number || 0);
    });

    modalHistoryTableBody.innerHTML = userScores
      .map((s) => {
        const ch = s.challenges || {};
        const wk = ch.weeks || {};
        const modeInfo = detectMapMode(ch.name);
        const total = s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));

        let ptsMapDisplay = "-";
        let rankMapDisplay = "-";
        if (currentCalculatedData) {
          const mapRes = currentCalculatedData.mapResults?.get(ch.id)?.get(userId);
          if (mapRes) {
            ptsMapDisplay = formatNum(mapRes.ptsMap);
            rankMapDisplay = formatRankDisplay(mapRes.rank);
          }
        }

        return `
          <tr>
            <td style="font-weight: 600; color: #475569;">${escapeHtml(wk.title || `W${ch.week_id}`)}</td>
            <td style="text-align: left; padding-left: 10px;">
              <strong>M${ch.seed_number}:</strong> ${renderFlags(escapeHtml(ch.name || `Seed ${ch.seed_number}`))}
            </td>
            <td><span class="mode-tag ${modeInfo.cls}">${modeInfo.label}</span></td>
            <td>${formatNum(s.r1)}</td>
            <td>${formatNum(s.r2)}</td>
            <td>${formatNum(s.r3)}</td>
            <td>${formatNum(s.r4)}</td>
            <td>${formatNum(s.r5)}</td>
            <td style="background: #eff6ff; font-weight: 700; color: #1e3a8a;">${formatNum(total)}</td>
            <td style="background: #00247d; color: white; font-weight: 700;">${ptsMapDisplay}</td>
            <td>${rankMapDisplay}</td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Open profile error:", err);
    modalHistoryTableBody.innerHTML = `<tr><td colspan="11" style="padding: 24px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
};

window.closePlayerProfileModal = function () {
  document.getElementById("playerProfileModal")?.classList.remove("open");
};

function detectMapMode(name) {
  if (!name) return { label: "Standard", cls: "other" };
  if (/nmpz/i.test(name)) return { label: "NMPZ", cls: "nmpz" };
  if (/\bnm\b|no\s*move/i.test(name)) return { label: "NM", cls: "nm" };
  if (/move/i.test(name)) return { label: "Move", cls: "move" };
  return { label: "Standard", cls: "other" };
}

// Modal Backdrop Click & Escape Key to close
window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) {
    e.target.classList.remove("open");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
  }
});

/**
 * 13. Supabase Realtime Setup (Optional, safe fallback)
 */
function setupRealtime() {
  if (!db || realtimeChannel) return;

  try {
    realtimeChannel = db
      .channel("public-league-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weeks" },
        () => handleRealtimeUpdate()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        () => handleRealtimeUpdate()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("🟢 Supabase Realtime connected");
        }
      });
  } catch (err) {
    console.warn("Realtime initialization skipped:", err);
  }
}

function handleRealtimeUpdate() {
  clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer = setTimeout(async () => {
    console.log("🔄 Realtime update triggered - refreshing active week data");
    if (currentWeek) {
      await selectWeek(currentWeek.id);
    }
  }, 2000);
}

/**
 * Render Country Flag Emojis into real flag images using Flagcdn
 * Fixes Windows OS issue where national flag emojis render as 2-letter codes (e.g. TH, UG, KE)
 */
function renderFlags(text) {
  if (!text) return "";

  // 1. UK Subdivisions: England, Scotland, Wales
  text = text
    .replace(/\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F/g,
      '<img class="flag-icon" src="https://flagcdn.com/24x18/gb-eng.png" srcset="https://flagcdn.com/48x36/gb-eng.png 2x" width="20" height="15" alt="ENG" loading="lazy">')
    .replace(/\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74\uDB40\uDC7F/g,
      '<img class="flag-icon" src="https://flagcdn.com/24x18/gb-sct.png" srcset="https://flagcdn.com/48x36/gb-sct.png 2x" width="20" height="15" alt="SCT" loading="lazy">')
    .replace(/\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F/g,
      '<img class="flag-icon" src="https://flagcdn.com/24x18/gb-wls.png" srcset="https://flagcdn.com/48x36/gb-wls.png 2x" width="20" height="15" alt="WLS" loading="lazy">');

  // 2. Standard 2-letter country flag emojis (Regional Indicator Symbols U+1F1E6 to U+1F1FF)
  const flagRegex = /\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]/g;
  text = text.replace(flagRegex, (match) => {
    const cp1 = match.codePointAt(0);
    const cp2 = match.codePointAt(2);
    const code = (
      String.fromCharCode(65 + cp1 - 0x1f1e6) +
      String.fromCharCode(65 + cp2 - 0x1f1e6)
    ).toLowerCase();
    return `<img class="flag-icon" src="https://flagcdn.com/24x18/${code}.png" srcset="https://flagcdn.com/48x36/${code}.png 2x" width="20" height="15" alt="${code.toUpperCase()}" loading="lazy">`;
  });

  // 3. Shortcodes like :th:, :flag_th:, :flag-th:
  text = text.replace(/:flag[-_]([a-z]{2}):|:([a-z]{2}):/gi, (match, p1, p2) => {
    let code = (p1 || p2).toLowerCase();
    if (code === "uk") code = "gb";
    return `<img class="flag-icon" src="https://flagcdn.com/24x18/${code}.png" srcset="https://flagcdn.com/48x36/${code}.png 2x" width="20" height="15" alt="${code.toUpperCase()}" loading="lazy">`;
  });

  return text;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

init();
