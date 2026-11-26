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
let selectedRawSeed = 1; // Map number 1 to 7
let selectedRawSubSeed = 0; // 0 = Map Overview (multi-seed), 1..N = specific seed
let selectedRawSubView = "map"; // "map" | "round"
let selectedRawRound = 0; // 0..4 = R1..R5, 5 = Total

let realtimeChannel = null;
let realtimeDebounceTimer = null;

function getMapNum(c) {
  return Number(c?.map_number || c?.seed_number || 0);
}

function getSubSeedNum(c) {
  return Number(c?.sub_seed_number || 1);
}

function getGameType(c) {
  return c?.game_type || "standard";
}

async function fetchAllRows(buildQueryFn, pageSize = 1000, maxPages = 100) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await buildQueryFn().range(from, to);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return { data: all, error: null };
}

function sortChallenges(list) {
  return [...(list || [])].sort(
    (a, b) => getMapNum(a) - getMapNum(b) || getSubSeedNum(a) - getSubSeedNum(b)
  );
}

function groupChallengesByMap(challenges) {
  const sorted = sortChallenges(challenges);
  const byMap = new Map();
  sorted.forEach((c) => {
    const m = getMapNum(c);
    if (!byMap.has(m)) {
      byMap.set(m, {
        mapNumber: m,
        name: c.name || `Map ${m}`,
        gameType: getGameType(c),
        seeds: [],
      });
    }
    byMap.get(m).seeds.push(c);
  });
  return Array.from(byMap.values()).sort((a, b) => a.mapNumber - b.mapNumber);
}

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
const rawSeedSelectorContainer = document.getElementById("rawSeedSelectorContainer");
const rawTableHead = document.getElementById("rawTableHead");
const rawTableBody = document.getElementById("rawTableBody");
const rawBtnMapSummary = document.getElementById("rawBtnMapSummary");
const rawBtnRoundDeep = document.getElementById("rawBtnRoundDeep");
const rawRoundSelectorContainer = document.getElementById("rawRoundSelectorContainer");
const rawCalcFootnote = document.getElementById("rawCalcFootnote");

const formatNum = (num) => (num !== undefined && num !== null ? Number(num).toLocaleString() : "-");
const formatPts = (num) => {
  if (num === undefined || num === null) return "-";
  const rounded = Math.round(Number(num) * 10) / 10;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
};

function formatRankDisplay(rank, total) {
  if (rank === undefined || rank === null || rank === "-") return "-";
  const suffix = total ? `<span style="font-size: 0.75em; color: #64748b; font-weight: 500;">/${total}</span>` : "";
  return `${rank}${suffix}`;
}

function formatPlayedTime(dateStr) {
  if (!dateStr) return '<span style="color: #94a3b8; font-size: 0.78rem;">-</span>';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '<span style="color: #94a3b8; font-size: 0.78rem;">-</span>';
  const datePart = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
  const timePart = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `<span title="${escapeHtml(d.toLocaleString("th-TH"))}" style="font-size: 0.75rem; color: #475569; font-weight: 600;">${datePart}, ${timePart}</span>`;
}

function getRankClass(rank) {
  if (rank === 1) return "rank-gold";
  if (rank === 2) return "rank-silver";
  if (rank === 3) return "rank-bronze";
  return "";
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

    // Filter to show ONLY Active (Present) and Frozen (Past) weeks to players
    // Hide Draft / Scheduled future weeks from viewers completely
    const now = new Date();
    const visibleWeeks = weeks.filter((w) => {
      if (w.is_frozen) return true; // Past competition is always visible
      if (w.is_active) {
        if (w.start_date && new Date(w.start_date) > now) {
          return false; // Scheduled for future, not started yet
        }
        return true; // Ongoing active competition
      }
      // สัปดาห์ที่ตั้ง start_date ไว้และถึงเวลาเริ่มแล้ว (เปิดแข่งต่อเนื่องทันที)
      if (!w.is_active && !w.is_frozen && w.start_date && new Date(w.start_date) <= now) {
        return true;
      }
      return false; // Draft / upcoming week
    });

    if (visibleWeeks.length === 0) {
      scoresTableBody.innerHTML = `
        <tr>
          <td colspan="17" style="padding: 50px 20px; text-align: center; color: #64748b;">
            <div style="font-size: 2.2rem; margin-bottom: 10px;">⏳</div>
            <div style="font-size: 1.15rem; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
              การแข่งขันรอบถัดไปกำลังจะเริ่มเร็ว ๆ นี้ (Coming Soon)
            </div>
            <div style="font-size: 0.85rem; color: #64748b;">
              ยังไม่มีสัปดาห์การแข่งขันที่เปิดให้เล่นในขณะนี้ กรุณาติดตามประกาศกำหนดการเปิดแข่งอีกครั้ง
            </div>
          </td>
        </tr>
      `;
      if (bannerTitle) bannerTitle.textContent = "🏆 GeoGuessr Weekly Challenge";
      if (bannerSubInfo) bannerSubInfo.textContent = "⏳ Next Week Coming Soon";
      if (countdownBadge) countdownBadge.style.display = "none";
      if (mapsGrid) mapsGrid.innerHTML = "";
      allWeeks = [];
      renderBottomTabs();
      return;
    }

    allWeeks = visibleWeeks;
    renderBottomTabs();

    const defaultWeek =
      allWeeks.find(
        (w) =>
          (w.is_active && (!w.start_date || new Date(w.start_date) <= now)) ||
          (!w.is_frozen && w.start_date && new Date(w.start_date) <= now)
      ) || allWeeks[0];
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

  // Load Challenges (7 Maps, each may have 1..N seeds)
  const { data: challenges } = await db
    .from("challenges")
    .select("*")
    .eq("week_id", weekId)
    .order("seed_number", { ascending: true });

  currentChallenges = sortChallenges(challenges || []);
  renderMapCards(currentChallenges);
  renderTableHeaders(currentChallenges);

  if (currentChallenges.length === 0) {
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 30px; text-align: center;">No maps found for this week.</td></tr>`;
    return;
  }

  // Load Scores (paginated + lightweight columns)
  const challengeIds = currentChallenges.map((c) => c.id);
  const needsRoundDetails =
    week.is_frozen && currentChallenges.some((c) => getGameType(c) === "country_count");
  const scoreCols = needsRoundDetails
    ? "id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, played_at, round_details, players(id, username)"
    : "id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, played_at, players(id, username)";

  let { data: scores, error: scErr } = await fetchAllRows(() =>
    db
      .from("scores")
      .select(scoreCols)
      .in("challenge_id", challengeIds)
      .order("id", { ascending: true })
  );

  if (
    scErr &&
    (scErr.message?.includes("played_at") ||
      scErr.message?.includes("round_details") ||
      scErr.code === "PGRST204")
  ) {
    const fb = await fetchAllRows(() =>
      db
        .from("scores")
        .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, players(id, username)")
        .in("challenge_id", challengeIds)
        .order("id", { ascending: true })
    );
    scores = fb.data;
  }

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

function renderMapLinksHtml(seeds, isHeaderCard = false) {
  if (!seeds || seeds.length === 0) return "";
  if (seeds.length === 1) {
    const c = seeds[0];
    const hasUrl = c.url && c.url.trim() !== "" && c.token && c.token.trim() !== "";
    return hasUrl
      ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" class="map-btn">▶ Play</a>`
      : `<span class="map-btn" style="opacity: 0.55; cursor: not-allowed; background: #64748b; font-size: ${isHeaderCard ? "0.75rem" : "0.8rem"};">🔒 Soon</span>`;
  }

  return `
    <div class="map-links-group">
      ${seeds
        .map((c) => {
          const sNum = getSubSeedNum(c);
          const hasUrl = c.url && c.url.trim() !== "" && c.token && c.token.trim() !== "";
          return hasUrl
            ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" class="map-btn multi" title="Play Seed ${sNum}">▶ Seed ${sNum}</a>`
            : `<span class="map-btn multi" style="opacity: 0.55; cursor: not-allowed; background: #64748b;" title="Seed ${sNum} Soon">🔒 Seed ${sNum}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderMapMetaBadgesHtml(grp) {
  const pills = [];
  if (grp.gameType === "country_count") {
    pills.push(`<span class="map-meta-pill">🌍 Country</span>`);
  }
  if (grp.seeds.length > 1) {
    pills.push(`<span class="map-meta-pill">${grp.seeds.length} Seeds</span>`);
  }
  if (pills.length === 0) return "";
  return `<div class="map-meta-badges">${pills.join("")}</div>`;
}

/**
 * 6. Render the 7 Map Cards
 */
function renderMapCards(challenges) {
  if (!mapsGrid) return;
  const mapGroups = groupChallengesByMap(challenges);
  if (!mapGroups.length) {
    mapsGrid.innerHTML = `<div style="grid-column: span 7; color: white; text-align: center;">No map data available</div>`;
    return;
  }

  mapsGrid.innerHTML = mapGroups
    .map(
      (grp) => `
      <div class="map-card">
        <div>
          <div class="map-title">Map ${grp.mapNumber}</div>
          <div class="map-desc">${renderFlags(escapeHtml(grp.name))}</div>
          ${renderMapMetaBadgesHtml(grp)}
        </div>
        ${renderMapLinksHtml(grp.seeds, false)}
      </div>
    `
    )
    .join("");
}

/**
 * 7. Render Table Headers (Directly locks Map Cards above score columns)
 */
function renderTableHeaders(challenges) {
  tableTopHeaderRow.innerHTML = `
    <th class="th-logo-cell" colspan="3">
      <div class="table-logo-card">
        <img src="logo.png" class="table-logo-img" alt="League Logo"
          onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
        <div class="table-logo-placeholder" style="display: none;">
          <span class="table-league-badge">GEOGUESSR</span>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 600;">THAILAND LEAGUE</span>
        </div>
      </div>
    </th>
  `;

  tableSubHeaderRow.innerHTML = `
    <th class="th-sub col-pos">Position</th>
    <th class="th-sub col-player">Pseudo</th>
    <th class="th-sub col-total">Points</th>
  `;

  const mapGroups = groupChallengesByMap(challenges);

  mapGroups.forEach((grp) => {
    tableTopHeaderRow.insertAdjacentHTML(
      "beforeend",
      `
      <th class="th-top-map m${grp.mapNumber}" colspan="2">
        <div class="table-map-card">
          <div class="map-card-info">
            <div class="map-card-title">Map ${grp.mapNumber}</div>
            <div class="map-card-desc">${renderFlags(escapeHtml(grp.name))}</div>
            ${renderMapMetaBadgesHtml(grp)}
          </div>
          ${renderMapLinksHtml(grp.seeds, true)}
        </div>
      </th>
    `
    );

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
 * 8. Single-Seed Scoring Helper (supports both 'standard' and 'country_count')
 */
function scoreSingleSeed(pList, gameType = "standard") {
  if (!pList || pList.length === 0) return [];
  const isCountryCount = gameType === "country_count";

  for (let m = 0; m < 6; m++) {
    const maxScore = isCountryCount ? (m < 5 ? 1 : 5) : (m < 5 ? 5000 : 25000);

    pList.forEach((p) => {
      p.points = p.points || [];
      p.phantoms = p.phantoms || [];
      p.h2h = p.h2h || [];

      const raw = p.raw[m];
      if (isCountryCount) {
        p.phantoms[m] = raw; // No Phantom Score
      } else {
        const missing = Math.max(0, maxScore - raw);
        p.phantoms[m] = raw + 0.1 * missing;
      }
    });

    pList.forEach((p, i) => {
      let ptsInRound = 0;
      let wins = 0;
      let ties = 0;
      let losses = 0;
      const pRaw = p.raw[m];
      const pPhan = p.phantoms[m];

      if (isCountryCount && pRaw === 0) {
        // Country Count: 0 in round (or 0 total) automatically receives 0 points (no half-ties with other 0s)
        pList.forEach((opp, j) => {
          if (i === j) return;
          if (opp.raw[m] > 0) losses += 1;
        });
        p.points[m] = 0;
        p.h2h[m] = { wins: 0, ties: 0, losses, zeroed: true };
      } else {
        pList.forEach((opp, j) => {
          if (i === j) return;
          const oppRaw = opp.raw[m];
          const oppPhan = opp.phantoms[m];

          if (isCountryCount) {
            if (pRaw > oppRaw) {
              ptsInRound += 1;
              wins += 1;
            } else if (pRaw === oppRaw) {
              ptsInRound += 0.5;
              ties += 1;
            } else {
              losses += 1;
            }
          } else {
            if (pRaw > oppPhan && oppRaw <= pPhan) {
              ptsInRound += 1;
              wins += 1;
            } else if (pRaw <= oppPhan && oppRaw <= pPhan) {
              ptsInRound += 0.5;
              ties += 1;
            } else {
              losses += 1;
            }
          }
        });

        p.points[m] = ptsInRound;
        p.h2h[m] = { wins, ties, losses, zeroed: false };
      }
    });
  }

  pList.forEach((p) => {
    p.ptsRounds = p.points.reduce((a, b) => a + b, 0);
    p.ptsMap = Math.round(p.ptsRounds);
  });

  pList.sort((a, b) => b.ptsMap - a.ptsMap || b.raw[5] - a.raw[5]);
  pList.forEach((p, idx) => {
    const isTie = idx > 0 && pList[idx - 1].ptsMap === p.ptsMap;
    p.mapRank = isTie ? pList[idx - 1].mapRank : idx + 1;
  });

  return pList;
}

/**
 * 8.1 Reusable Week Calculation (supports Multi-Seed averaging & Country Count)
 */
function computeWeekStandings(challenges, scores) {
  const mapGroups = groupChallengesByMap(challenges);
  const playersBySeed = new Map();
  const allPlayerIds = new Set();
  const playerNames = new Map();

  challenges.forEach((c) => playersBySeed.set(c.id, []));

  scores.forEach((s) => {
    const chId = s.challenge_id;
    const uId = s.player_id;
    const uName = s.players?.username || "Unknown";

    allPlayerIds.add(uId);
    playerNames.set(uId, uName);

    if (playersBySeed.has(chId)) {
      playersBySeed.get(chId).push({
        userId: uId,
        username: uName,
        playedAt: s.played_at || null,
        roundDetails: s.round_details || null,
        raw: [
          s.r1,
          s.r2,
          s.r3,
          s.r4,
          s.r5,
          s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0)),
        ],
      });
    }
  });

  // 1. คำนวณคะแนนแยกทีละ Seed (Challenge ID)
  const seedResultsMap = new Map();
  challenges.forEach((c) => {
    const pList = playersBySeed.get(c.id) || [];
    const resultMap = new Map();

    if (pList.length > 0) {
      scoreSingleSeed(pList, getGameType(c));
      const maxRounds = [0, 1, 2, 3, 4].map((m) => Math.max(...pList.map((p) => p.raw[m])));

      pList.forEach((p) => {
        let roundWins = 0;
        for (let m = 0; m < 5; m++) {
          if (p.raw[m] === maxRounds[m] && maxRounds[m] > 0) {
            roundWins++;
          }
        }

        resultMap.set(p.userId, {
          userId: p.userId,
          username: p.username,
          playedAt: p.playedAt,
          roundDetails: p.roundDetails,
          ptsMap: p.ptsMap,
          rank: p.mapRank,
          totalPlayers: pList.length,
          raw: p.raw,
          phantoms: p.phantoms,
          points: p.points,
          h2h: p.h2h,
          ptsRounds: p.ptsRounds,
          maxRounds: maxRounds,
          roundWins: roundWins,
          isMapWin: p.mapRank === 1,
        });
      });
    }

    seedResultsMap.set(c.id, resultMap);
  });

  // 2. รวมและเฉลี่ยคะแนนระดับ Map (1..7) — ถ้ามี K seeds ให้นำมาบวกกันหาร K
  const mapResults = new Map(); // mapNumber -> Map(userId -> aggregated map result)

  mapGroups.forEach((grp) => {
    const seedCount = grp.seeds.length;
    const aggMap = new Map();

    grp.seeds.forEach((ch) => {
      const sResMap = seedResultsMap.get(ch.id);
      if (!sResMap) return;
      sResMap.forEach((res, uId) => {
        if (!aggMap.has(uId)) {
          aggMap.set(uId, {
            userId: uId,
            username: res.username,
            sumPts: 0,
            sumRaw: 0,
            seedsPlayed: 0,
            seedCount,
            seedResults: {},
          });
        }
        const agg = aggMap.get(uId);
        agg.sumPts += res.ptsMap;
        agg.sumRaw += res.raw[5];
        agg.seedsPlayed += 1;
        agg.seedResults[ch.id] = res;
      });
    });

    const aggList = Array.from(aggMap.values()).map((agg) => ({
      ...agg,
      ptsMap: seedCount === 1 ? agg.sumPts : Math.round((agg.sumPts / seedCount) * 10) / 10,
    }));

    aggList.sort((a, b) => b.ptsMap - a.ptsMap || b.sumRaw - a.sumRaw);

    const groupResultMap = new Map();
    aggList.forEach((p, idx) => {
      const isTie = idx > 0 && aggList[idx - 1].ptsMap === p.ptsMap;
      p.rank = isTie ? aggList[idx - 1].rank : idx + 1;
      p.totalPlayers = aggList.length;
      p.isMapWin = p.rank === 1;
      groupResultMap.set(p.userId, p);
    });

    mapResults.set(grp.mapNumber, groupResultMap);
  });

  // 3. Grand Total across all 7 Maps in this week
  const leaderboard = [];

  allPlayerIds.forEach((uId) => {
    let grandTotal = 0;
    const playerMapStats = {};

    mapGroups.forEach((grp) => {
      const res = mapResults.get(grp.mapNumber)?.get(uId);
      if (res) {
        grandTotal += res.ptsMap;
        playerMapStats[grp.mapNumber] = res;
      } else {
        playerMapStats[grp.mapNumber] = null;
      }
    });

    grandTotal = Math.round(grandTotal * 10) / 10;

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

  return { leaderboard, mapResults, seedResultsMap, mapGroups, playerNames };
}

/**
 * 8.2 Calculate and render Main Leaderboard Table for Current Week
 */
function calculateAndRenderScores(scores, challenges) {
  const { leaderboard, mapResults, seedResultsMap, mapGroups, playerNames } = computeWeekStandings(
    challenges,
    scores
  );

  currentCalculatedData = { mapResults, seedResultsMap, mapGroups, challenges, playerNames, leaderboard };

  if (leaderboard.length === 0) {
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">No players have completed 5 rounds in this week yet.</td></tr>`;
    return;
  }

  scoresTableBody.innerHTML = leaderboard
    .map((p) => {
      const posDisplay = formatRankDisplay(p.overallRank);
      const posClass = `col-pos ${getRankClass(p.overallRank)}`.trim();

      // Count played maps out of total map groups
      const playedMapsCount = mapGroups.filter((grp) => p.maps[grp.mapNumber]).length;
      const totalMapsCount = mapGroups.length || 7;
      const badgeCls = playedMapsCount === totalMapsCount ? "played-badge complete" : "played-badge";
      const playedBadge = `<span class="${badgeCls}" title="Completed ${playedMapsCount} of ${totalMapsCount} maps">[${playedMapsCount}/${totalMapsCount}]</span>`;

      const mapCols = mapGroups
        .map((grp) => {
          const mData = p.maps[grp.mapNumber];
          if (!mData) {
            return `
              <td class="col-pts" style="color: #cbd5e1;">-</td>
              <td class="col-rank" style="color: #cbd5e1;">-</td>
            `;
          }

          const rankDisplay = formatRankDisplay(mData.rank);
          const mapRankClass = `col-rank ${getRankClass(mData.rank)}`.trim();
          const partialSeedTitle =
            mData.seedCount > 1
              ? `Played ${mData.seedsPlayed}/${mData.seedCount} seeds (Avg = ${mData.sumPts}/${mData.seedCount})`
              : "";
          const partialTag =
            mData.seedCount > 1 && mData.seedsPlayed < mData.seedCount
              ? `<span style="font-size:0.65rem;color:#b45309;display:block;">[${mData.seedsPlayed}/${mData.seedCount}]</span>`
              : "";

          return `
            <td class="col-pts" title="${escapeHtml(partialSeedTitle)}">${formatPts(mData.ptsMap)}${partialTag}</td>
            <td class="${mapRankClass}">${rankDisplay}</td>
          `;
        })
        .join("");

      return `
        <tr>
          <td class="${posClass}">${posDisplay}</td>
          <td class="col-player" title="${escapeHtml(p.username)}">
            <span class="player-name">${escapeHtml(p.username)}</span>${playedBadge}
          </td>
          <td class="col-total">${formatPts(p.grandTotal)}</td>
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
 * 9. Render Raw Scores Table and Calculation Inspector for the selected Map
 */
function renderRawScoresView() {
  if (!currentCalculatedData || !currentChallenges.length) return;

  const { mapResults, seedResultsMap, mapGroups } = currentCalculatedData;
  if (!mapGroups || !mapGroups.length) return;

  // 1. Render Map Pills
  if (rawMapSelectorPills) {
    rawMapSelectorPills.innerHTML = mapGroups
      .map((grp) => {
        const isSel = grp.mapNumber === selectedRawSeed;
        const typeIcon = grp.gameType === "country_count" ? " 🌍" : "";
        const seedTag = grp.seeds.length > 1 ? ` (${grp.seeds.length} Seeds)` : "";
        return `
          <button class="raw-map-pill ${isSel ? "active" : ""}" onclick="selectRawMapSeed(${grp.mapNumber})">
            🗺️ Map ${grp.mapNumber}${typeIcon}: ${renderFlags(escapeHtml(grp.name))}${seedTag}
          </button>
        `;
      })
      .join("");
  }

  const activeGroup = mapGroups.find((g) => g.mapNumber === selectedRawSeed) || mapGroups[0];
  if (!activeGroup) return;

  const isCountry = activeGroup.gameType === "country_count";

  // 1.1 Seed Selector Pills (visible when selected Map has > 1 seed)
  if (rawSeedSelectorContainer) {
    if (activeGroup.seeds.length > 1) {
      rawSeedSelectorContainer.style.display = "flex";
      const seedBtns = activeGroup.seeds
        .map((s) => {
          const sNum = getSubSeedNum(s);
          const isSel = selectedRawSubSeed === sNum;
          return `<button class="raw-map-pill ${isSel ? "active" : ""}" onclick="selectRawSubSeed(${sNum})">Seed ${sNum}</button>`;
        })
        .join("");

      rawSeedSelectorContainer.innerHTML = `
        <strong style="color: #475569; font-size: 0.85rem; margin-right: 4px;">เลือก Seed:</strong>
        <button class="raw-map-pill ${selectedRawSubSeed === 0 ? "active" : ""}" onclick="selectRawSubSeed(0)">
          📊 ภาพรวม Map (เฉลี่ย ÷ ${activeGroup.seeds.length})
        </button>
        ${seedBtns}
      `;
    } else {
      rawSeedSelectorContainer.style.display = "none";
      selectedRawSubSeed = 1;
    }
  }

  // Multi-seed Overview Mode
  if (activeGroup.seeds.length > 1 && selectedRawSubSeed === 0) {
    if (rawBtnMapSummary && rawBtnRoundDeep && rawRoundSelectorContainer) {
      rawBtnMapSummary.classList.add("active");
      rawBtnRoundDeep.classList.remove("active");
      rawRoundSelectorContainer.style.display = "none";
    }

    if (rawCalcFootnote) {
      rawCalcFootnote.textContent = `* แมพนี้มีทั้งหมด ${activeGroup.seeds.length} Seeds — คะแนนประจำ Map คำนวณจาก (ผลรวมคะแนนทุก Seed) ÷ ${activeGroup.seeds.length}`;
    }

    const groupResultMap = mapResults.get(activeGroup.mapNumber);
    const playersList = groupResultMap ? Array.from(groupResultMap.values()) : [];

    if (playersList.length === 0) {
      if (rawTableHead) rawTableHead.innerHTML = "";
      if (rawTableBody) {
        rawTableBody.innerHTML = `<tr><td colspan="10" style="padding: 30px; text-align: center; color: #64748b;">ยังไม่มีผู้เล่นในแมพนี้</td></tr>`;
      }
      return;
    }

    const seedHeaders = activeGroup.seeds
      .map((s) => `<th style="min-width: 95px;">Seed ${getSubSeedNum(s)}</th>`)
      .join("");

    if (rawTableHead) {
      rawTableHead.innerHTML = `
        <tr>
          <th style="width: 55px;">#</th>
          <th style="text-align: left; padding-left: 12px; width: 170px;">ผู้เล่น (Pseudo)</th>
          ${seedHeaders}
          <th style="width: 115px; background: #00247d; color: white;">Map Points (÷${activeGroup.seeds.length})</th>
        </tr>
      `;
    }

    if (rawTableBody) {
      rawTableBody.innerHTML = playersList
        .map((p) => {
          const rankDisplay = formatRankDisplay(p.rank);
          const posClass = `col-pos ${getRankClass(p.rank)}`.trim();

          const seedCols = activeGroup.seeds
            .map((s) => {
              const sd = p.seedResults[s.id];
              if (!sd) {
                return `<td class="raw-cell" style="color: #cbd5e1;">-</td>`;
              }
              const rawTxt = isCountry ? `${sd.raw[5]}/5 🌍` : formatNum(sd.raw[5]);
              return `
                <td class="raw-cell">
                  <div class="raw-score-val">${formatPts(sd.ptsMap)} pts</div>
                  <div class="raw-pts-badge">${rawTxt}</div>
                </td>
              `;
            })
            .join("");

          return `
            <tr>
              <td class="${posClass}">${rankDisplay}</td>
              <td class="col-player"><span class="player-name">${escapeHtml(p.username)}</span></td>
              ${seedCols}
              <td class="col-total" style="font-size: 1rem; color: #00247d;">${formatPts(p.ptsMap)}</td>
            </tr>
          `;
        })
        .join("");
    }
    return;
  }

  // Single-seed (or selected sub-seed) view
  const activeChallenge =
    activeGroup.seeds.find((s) => getSubSeedNum(s) === selectedRawSubSeed) || activeGroup.seeds[0];
  const resultMap = activeChallenge ? seedResultsMap.get(activeChallenge.id) : null;

  // 2. Sub-View Button and Round Pill States
  if (rawBtnMapSummary && rawBtnRoundDeep && rawRoundSelectorContainer) {
    if (selectedRawSubView === "map") {
      rawBtnMapSummary.classList.add("active");
      rawBtnRoundDeep.classList.remove("active");
      rawRoundSelectorContainer.style.display = "none";
    } else {
      rawBtnMapSummary.classList.remove("active");
      rawBtnRoundDeep.classList.add("active");
      rawRoundSelectorContainer.style.display = "flex";

      document.querySelectorAll(".raw-round-btn").forEach((btn) => {
        const rnd = parseInt(btn.getAttribute("data-rnd"), 10);
        if (rnd === 5) {
          btn.textContent = isCountry ? "Total (0-5)" : "Total (25k)";
        }
        if (rnd === selectedRawRound) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }
  }

  if (rawCalcFootnote) {
    rawCalcFootnote.textContent = isCountry
      ? "* โหมด Country Count: ไม่มี Phantom Score — ถูกประเทศ (1) เทียบ Head-to-Head ปกติ, ผิดประเทศหรือได้ Total = 0 จะได้ 0 แต้มในรอบนั้นทันที"
      : "* คำนวณด้วยระบบ Pairwise Head-to-Head (Half-Tie: ชนะ 1 แต้ม, เสมอ 0.5 แต้ม, แพ้ 0 แต้ม) เทียบกับ Phantom Score (บวก 10% ของคะแนนที่ขาด) ของคู่แข่งทุกคนในรอบนั้น";
  }

  if (!resultMap || resultMap.size === 0) {
    if (rawTableHead) rawTableHead.innerHTML = "";
    if (rawTableBody) {
      rawTableBody.innerHTML = `<tr><td colspan="10" style="padding: 30px; text-align: center; color: #64748b;">ยังไม่มีผู้เล่นใน Seed นี้</td></tr>`;
    }
    return;
  }

  const playersList = Array.from(resultMap.values());

  if (selectedRawSubView === "map") {
    if (rawTableHead) {
      rawTableHead.innerHTML = `
        <tr>
          <th style="width: 55px;">#</th>
          <th style="text-align: left; padding-left: 12px; width: 170px;">ผู้เล่น (Pseudo)</th>
          <th style="width: 110px; text-align: center;">เวลาที่เล่น</th>
          <th style="width: 85px;">Round 1</th>
          <th style="width: 85px;">Round 2</th>
          <th style="width: 85px;">Round 3</th>
          <th style="width: 85px;">Round 4</th>
          <th style="width: 85px;">Round 5</th>
          <th style="width: 110px; background: #eff6ff; color: #1e3a8a;">${isCountry ? "Total (0-5)" : "Total (25k)"}</th>
          <th style="width: 95px; background: #00247d; color: white;">${activeGroup.seeds.length > 1 ? "Seed Points" : "Map Points"}</th>
        </tr>
      `;
    }

    playersList.sort((a, b) => b.ptsMap - a.ptsMap || b.raw[5] - a.raw[5]);

    if (rawTableBody) {
      rawTableBody.innerHTML = playersList
        .map((p) => {
          const rankDisplay = formatRankDisplay(p.rank);
          const posClass = `col-pos ${getRankClass(p.rank)}`.trim();

          const roundCells = [0, 1, 2, 3, 4]
            .map((rIdx) => {
              const rawVal = p.raw[rIdx];
              const ptsVal = p.points[rIdx];
              let rawDisplay = formatNum(rawVal);
              let titleAttr = "";
              if (isCountry) {
                const det = Array.isArray(p.roundDetails) ? p.roundDetails[rIdx] : null;
                rawDisplay = rawVal === 1 ? "✅ 1" : "❌ 0";
                if (det?.target) {
                  titleAttr = det.ok
                    ? `Target: ${det.target} (Correct)`
                    : `Target: ${det.target}, Guess: ${det.guess || "None"}`;
                }
              }
              return `
                <td class="raw-cell" title="${escapeHtml(titleAttr)}">
                  <div class="raw-score-val">${rawDisplay}</div>
                  <div class="raw-pts-badge">+${formatPts(ptsVal)} pts</div>
                </td>
              `;
            })
            .join("");

          const totalRaw = p.raw[5];
          const totalPts = p.points[5];
          const totalCell = `
            <td class="raw-cell" style="background: #eff6ff;">
              <div class="raw-score-val" style="color: #1e3a8a;">${isCountry ? `${totalRaw} / 5` : formatNum(totalRaw)}</div>
              <div class="raw-pts-badge" style="background: #bfdbfe; color: #1e3a8a;">+${formatPts(totalPts)} pts</div>
            </td>
          `;

          return `
            <tr>
              <td class="${posClass}">${rankDisplay}</td>
              <td class="col-player">
                <span class="player-name">${escapeHtml(p.username)}</span>
              </td>
              <td style="text-align: center; padding: 6px 4px;">${formatPlayedTime(p.playedAt)}</td>
              ${roundCells}
              ${totalCell}
              <td class="col-total" style="font-size: 1rem; color: #00247d;">${formatPts(p.ptsMap)}</td>
            </tr>
          `;
        })
        .join("");
    }
  } else {
    // Sub-view 2: Round Deep-Dive
    const m = selectedRawRound;

    if (rawTableHead) {
      rawTableHead.innerHTML = `
        <tr>
          <th style="width: 55px;">#</th>
          <th style="text-align: left; padding-left: 12px; width: 170px;">ผู้เล่น (Pseudo)</th>
          <th style="width: 110px; text-align: center;">เวลาที่เล่น</th>
          <th style="width: 110px; text-align: center;">${isCountry ? "ผลทาย" : "คะแนนดิบ (Raw)"}</th>
          <th style="width: 120px; text-align: center; background: #eff6ff; color: #1e3a8a;">${isCountry ? "Phantom" : "Phantom (10%)"}</th>
          <th style="text-align: left; padding-left: 12px;">ผลการเจอกับคู่แข่งอีก ${Math.max(0, playersList.length - 1)} คน (H2H)</th>
          <th style="width: 110px; text-align: center; background: #00247d; color: white;">แต้มรอบนี้</th>
        </tr>
      `;
    }

    const roundPlayers = [...playersList].sort((a, b) => b.points[m] - a.points[m] || b.raw[m] - a.raw[m]);
    roundPlayers.forEach((p, idx) => {
      const isTie = idx > 0 && roundPlayers[idx - 1].points[m] === p.points[m];
      p.roundRank = isTie ? roundPlayers[idx - 1].roundRank : idx + 1;
    });

    if (rawTableBody) {
      rawTableBody.innerHTML = roundPlayers
        .map((p) => {
          const rankCls = `col-pos ${getRankClass(p.roundRank)}`.trim();
          const h = p.h2h?.[m] || { wins: 0, ties: 0, losses: 0 };
          const phantomVal = isCountry
            ? "ไม่มี (0%)"
            : p.phantoms?.[m] !== undefined
              ? p.phantoms[m].toFixed(1)
              : "-";
          const rawDisplay = isCountry
            ? m < 5
              ? p.raw[m] === 1
                ? "✅ ถูก (1)"
                : "❌ ผิด (0)"
              : `${p.raw[m]} / 5`
            : formatNum(p.raw[m]);

          let outcomeBadge = "";
          if (h.zeroed) {
            outcomeBadge = `
              <span style="display: inline-block; background: #fee2e2; color: #b91c1c; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">
                ได้ 0 → ตีตก 0 แต้มทันที
              </span>
            `;
          } else {
            outcomeBadge = `
              <span style="display: inline-block; background: #dcfce7; color: #15803d; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">
                ชนะ ${h.wins}
              </span>
            `;
            if (h.ties > 0) {
              outcomeBadge += `
                <span style="display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 0.78rem; margin-left: 4px;">
                  เสมอ ${h.ties}
                </span>
              `;
            }
            outcomeBadge += `
              <span style="display: inline-block; background: #f1f5f9; color: #64748b; padding: 2px 7px; border-radius: 4px; font-weight: 600; font-size: 0.78rem; margin-left: 4px;">
                แพ้ ${h.losses}
              </span>
            `;
          }

          return `
            <tr>
              <td class="${rankCls}">${p.roundRank}</td>
              <td class="col-player">
                <span class="player-name">${escapeHtml(p.username)}</span>
              </td>
              <td style="text-align: center; padding: 6px 4px;">${formatPlayedTime(p.playedAt)}</td>
              <td style="text-align: center; font-weight: 700; color: #0f172a;">${rawDisplay}</td>
              <td style="text-align: center; font-weight: 700; color: #1e3a8a; background: #f0f7ff;">${phantomVal}</td>
              <td style="padding: 8px 12px; text-align: left;">${outcomeBadge}</td>
              <td style="text-align: center; font-weight: 800; font-size: 1rem; color: #15803d; background: #f8fafc;">
                +${formatPts(p.points[m])} pts
              </td>
            </tr>
          `;
        })
        .join("");
    }
  }
}

window.selectRawMapSeed = function (mapNum) {
  selectedRawSeed = mapNum;
  const grp = currentCalculatedData?.mapGroups?.find((g) => g.mapNumber === mapNum);
  selectedRawSubSeed = grp && grp.seeds.length > 1 ? 0 : 1;
  renderRawScoresView();
};

window.selectRawSubSeed = function (subSeedNum) {
  selectedRawSubSeed = subSeedNum;
  renderRawScoresView();
};

window.setRawSubView = function (subView) {
  selectedRawSubView = subView;
  renderRawScoresView();
};

window.selectRawRound = function (rndIdx) {
  selectedRawRound = rndIdx;
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
    const { data: challenges, error: chErr } = await fetchAllRows(() =>
      db
        .from("challenges")
        .select("id, week_id, seed_number, map_number, sub_seed_number, game_type, name")
        .in("week_id", frozenWeekIds)
        .order("id", { ascending: true })
    );

    if (chErr) throw chErr;

    const chIds = (challenges || []).map((c) => c.id);
    const { data: scores, error: scErr } =
      chIds.length === 0
        ? { data: [], error: null }
        : await fetchAllRows(() =>
            db
              .from("scores")
              .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, players(id, username)")
              .in("challenge_id", chIds)
              .order("id", { ascending: true })
          );

    if (scErr) throw scErr;

    const weeklyStandingsMap = new Map();
    const playerCumulative = new Map();

    frozenWeeks.forEach((w) => {
      const wChallenges = (challenges || []).filter((c) => c.week_id === w.id);
      const wChIds = new Set(wChallenges.map((c) => c.id));
      const wScores = (scores || []).filter((s) => wChIds.has(s.challenge_id));

      const { leaderboard, mapResults, seedResultsMap } = computeWeekStandings(wChallenges, wScores);
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
          totalInWeek: N,
          grandTotal: p.grandTotal,
        };

        if (p.overallRank === 1) cp.podiums.gold++;
        else if (p.overallRank === 2) cp.podiums.silver++;
        else if (p.overallRank === 3) cp.podiums.bronze++;
      });

      weeklyStandingsMap.set(w.id, { leaderboard, mapResults, seedResultsMap, N });
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
        const posClass = `col-pos ${getRankClass(p.seasonRank)}`.trim();

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
            <td class="${posClass}">${posDisplay}</td>
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
  const statMapWins = document.getElementById("statMapWins");
  const statRoundWins = document.getElementById("statRoundWins");
  const stat5kRounds = document.getElementById("stat5kRounds");
  const stat25kGames = document.getElementById("stat25kGames");
  const modalHistoryTableBody = document.getElementById("modalHistoryTableBody");

  modalPlayerUsername.textContent = "Loading Profile...";
  modalPlayerIdSub.textContent = `User ID: ${userId}`;
  modalGeoguessrLink.href = `https://www.geoguessr.com/user/${userId}`;
  modalHistoryTableBody.innerHTML = `<tr><td colspan="11" style="padding: 24px; text-align: center; color: #64748b;">Loading player stats...</td></tr>`;

  modal.classList.add("open");

  try {
    // Ensure season standings cache is loaded for accurate frozen stats
    if (!seasonStandingsCache) {
      await loadAndRenderSeasonStandings();
    }

    const { data: scores, error: scErr } = await fetchAllRows(() =>
      db
        .from("scores")
        .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, challenges(*, weeks(*)), players(username)")
        .eq("player_id", userId)
        .order("id", { ascending: true })
    );

    if (scErr) throw scErr;

    const allScores = scores || [];
    const username = allScores[0]?.players?.username || "Player";
    modalPlayerUsername.textContent = username;

    // Filter to ONLY include scores from completed (frozen) weeks to avoid spoilers for ongoing weeks!
    const userScores = allScores.filter(
      (s) => s.challenges?.weeks?.is_frozen === true
    );

    // Season stats from season cache if available
    let seasonPts = "0";
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
      if (statMapWins) statMapWins.textContent = "0";
      if (statRoundWins) statRoundWins.textContent = "0";
      stat5kRounds.textContent = "0";
      stat25kGames.textContent = "0";
      statWeeksPlayed.textContent = "0";
      modalHistoryTableBody.innerHTML = `
        <tr>
          <td colspan="11" style="padding: 30px; text-align: center; color: #64748b;">
            🔒 No recorded scores from completed (frozen) weeks yet.<br>
            <span style="font-size: 0.8rem; color: #94a3b8;">(Scores from ongoing active weeks are hidden to prevent spoilers)</span>
          </td>
        </tr>`;
      return;
    }

    let count5k = 0;
    let count25k = 0;
    let countMapWins = 0;
    let countRoundWins = 0;
    const uniqueWeeks = new Set();
    const countedMapWins = new Set(); // weekId:mapNumber

    userScores.forEach((s) => {
      const ch = s.challenges || {};
      const gType = getGameType(ch);
      if (gType !== "country_count") {
        [s.r1, s.r2, s.r3, s.r4, s.r5].forEach((r) => {
          if (r === 5000) count5k++;
        });
        if (s.total_score === 25000) count25k++;
      }
      if (ch.week_id) uniqueWeeks.add(ch.week_id);

      const wkStandings = seasonStandingsCache?.weeklyStandingsMap?.get(ch.week_id);
      const mapNum = getMapNum(ch);
      const mapGroupRes = wkStandings?.mapResults?.get(mapNum)?.get(userId);
      const mapWinKey = `${ch.week_id}:${mapNum}`;
      if (mapGroupRes?.isMapWin && !countedMapWins.has(mapWinKey)) {
        countedMapWins.add(mapWinKey);
        countMapWins++;
      }
      const seedRes = wkStandings?.seedResultsMap?.get(s.challenge_id)?.get(userId);
      if (seedRes) {
        countRoundWins += seedRes.roundWins || 0;
      }
    });

    if (statMapWins) statMapWins.textContent = countMapWins.toLocaleString();
    if (statRoundWins) statRoundWins.textContent = countRoundWins.toLocaleString();
    stat5kRounds.textContent = count5k.toLocaleString();
    stat25kGames.textContent = count25k.toLocaleString();
    statWeeksPlayed.textContent = uniqueWeeks.size.toLocaleString();

    userScores.sort((a, b) => {
      const wA = a.challenges?.week_id || 0;
      const wB = b.challenges?.week_id || 0;
      if (wB !== wA) return wB - wA;
      return getMapNum(a.challenges) - getMapNum(b.challenges) || getSubSeedNum(a.challenges) - getSubSeedNum(b.challenges);
    });

    modalHistoryTableBody.innerHTML = userScores
      .map((s) => {
        const ch = s.challenges || {};
        const wk = ch.weeks || {};
        const isCountry = getGameType(ch) === "country_count";
        const modeInfo = isCountry ? { label: "Country", cls: "other" } : detectMapMode(ch.name);
        const total = s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));

        let ptsMapDisplay = "-";
        let rankMapDisplay = "-";

        const wkStandings = seasonStandingsCache?.weeklyStandingsMap?.get(ch.week_id);
        const seedRes = wkStandings?.seedResultsMap?.get(ch.id)?.get(userId);

        let rankCls = "";
        if (seedRes) {
          ptsMapDisplay = formatPts(seedRes.ptsMap);
          rankMapDisplay = formatRankDisplay(seedRes.rank, seedRes.totalPlayers);
          rankCls = getRankClass(seedRes.rank);
        }

        const maxR = seedRes?.maxRounds || [];
        const renderR = (val, idx) => {
          if (isCountry) {
            return Number(val) === 1
              ? `<span style="font-weight: 700; color: #15803d;">✅ 1</span>`
              : `<span style="color: #94a3b8;">❌ 0</span>`;
          }
          const isWin = maxR[idx] !== undefined && val === maxR[idx] && maxR[idx] > 0;
          if (isWin) {
            return `<span style="font-weight: 700; color: #15803d;" title="Round ${idx + 1} Best Score in this seed!">★ ${formatNum(val)}</span>`;
          }
          return formatNum(val);
        };

        const mNum = getMapNum(ch);
        const sNum = getSubSeedNum(ch);
        const seedSubText = sNum > 1 ? ` (S${sNum})` : "";

        return `
          <tr>
            <td style="font-weight: 600; color: #475569;">${escapeHtml(wk.title || `W${ch.week_id}`)}</td>
            <td style="text-align: left; padding-left: 10px;">
              <strong>M${mNum}${seedSubText}:</strong> ${renderFlags(escapeHtml(ch.name || `Map ${mNum}`))}
            </td>
            <td><span class="mode-tag ${modeInfo.cls}">${modeInfo.label}</span></td>
            <td>${renderR(s.r1, 0)}</td>
            <td>${renderR(s.r2, 1)}</td>
            <td>${renderR(s.r3, 2)}</td>
            <td>${renderR(s.r4, 3)}</td>
            <td>${renderR(s.r5, 4)}</td>
            <td style="background: #eff6ff; font-weight: 700; color: #1e3a8a;">${isCountry ? `${total}/5` : formatNum(total)}</td>
            <td style="background: #00247d; color: white; font-weight: 700;">${ptsMapDisplay}</td>
            <td class="${rankCls}">${rankMapDisplay}</td>
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

let isRealtimeRefreshing = false;

function handleRealtimeUpdate() {
  clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer = setTimeout(async () => {
    if (isRealtimeRefreshing) return;
    try {
      isRealtimeRefreshing = true;
      console.log("🔄 Realtime update triggered - refreshing active week data");
      if (currentWeek) {
        await selectWeek(currentWeek.id);
      }
    } finally {
      isRealtimeRefreshing = false;
    }
  }, 2500);
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
