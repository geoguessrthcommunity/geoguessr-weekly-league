// ====================================================================
// GeoGuessr Weekly Challenge - Frontend App Logic
// Pure English UI (Rules tab is Bilingual English + Thai)
// ====================================================================

let db = null;
let allWeeks = [];
let currentWeek = null;
let currentChallenges = [];
let currentCalculatedData = null;

let currentMainView = "leaderboard"; // "leaderboard" | "raw"
let selectedRawSeed = 1; // 1 to 7

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
  excelTabsList.innerHTML = "";
  excelTabsList.appendChild(rulesTab);
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
  rulesView.style.display = "none";

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
  // When active: completely hide the switcher and show only leaderboard
  // When frozen: show the switcher so users can toggle between Leaderboard and Raw Scores
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
  // If week is not frozen, force leaderboard only
  if (!currentWeek?.is_frozen) {
    viewName = "leaderboard";
  }

  currentMainView = viewName;
  rulesView.style.display = "none";
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
 * 5. Switch to Rules View
 */
window.switchTab = function (tabName) {
  if (tabName === "rules") {
    document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));
    document.getElementById("tabRules").classList.add("active");

    // Hide leaderboard and raw views
    leaderboardView.style.display = "none";
    rawScoresView.style.display = "none";
    viewSwitchBar.style.display = "none";

    // Hide Top Section (7 Map Cards) so they don't leak into rules
    if (topSection) topSection.style.display = "none";

    // Update Banner for Rules
    bannerTitle.textContent = "📜 Rules & Scoring / กฎและกติกาการแข่งขัน";
    bannerSubInfo.textContent = "Season 1 (Nov 14, 2026 – Jan 1, 2027)";

    // Stop and hide countdown on rules page
    if (countdownBadge) countdownBadge.style.display = "none";
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    rulesView.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
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
 * 8. Phantom Score (10% Threshold) Algorithm
 */
function calculateAndRenderScores(scores, challenges) {
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

  currentCalculatedData = { mapResults, challenges, playerNames };

  // 4. Grand Total across all 7 Maps
  const finalLeaderboard = [];

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

    finalLeaderboard.push({
      userId: uId,
      username: playerNames.get(uId) || "Unknown",
      grandTotal,
      maps: playerMapStats,
    });
  });

  if (finalLeaderboard.length === 0) {
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">No players have completed 5 rounds in this week yet.</td></tr>`;
    return;
  }

  // Sort overall standings
  finalLeaderboard.sort((a, b) => b.grandTotal - a.grandTotal);

  for (let i = 0; i < finalLeaderboard.length; i++) {
    if (i > 0 && finalLeaderboard[i].grandTotal === finalLeaderboard[i - 1].grandTotal) {
      finalLeaderboard[i].overallRank = finalLeaderboard[i - 1].overallRank;
    } else {
      finalLeaderboard[i].overallRank = i + 1;
    }
  }

  // Render Main Leaderboard Table
  scoresTableBody.innerHTML = finalLeaderboard
    .map((p) => {
      const posDisplay = formatRankDisplay(p.overallRank);

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
          <td class="col-player" title="${escapeHtml(p.username)}">${escapeHtml(p.username)}</td>
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
          <td class="col-player">${escapeHtml(p.username)}</td>
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
