// ====================================================================
// GeoGuessr Weekly Challenge - Frontend App Logic
// ระบบคำนวณ Phantom Score (10% Missing-Score Threshold)
// สไตล์ Google Sheets / Excel Dashboard พร้อมแท็บสลับดูคะแนนดิบ
// ====================================================================

let db = null;
let allWeeks = [];
let currentWeek = null;
let currentChallenges = [];
let currentCalculatedData = null; // เก็บผลลัพธ์คำนวณสำหรับหน้าคะแนนดิบ

let currentMainView = "leaderboard"; // "leaderboard" | "raw"
let selectedRawSeed = 1; // Map ที่เลือกดูคะแนนดิบ (1 - 7)

if (CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
  db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

// องค์ประกอบ DOM
const bannerTitle = document.getElementById("bannerTitle");
const bannerSubInfo = document.getElementById("bannerSubInfo");
const lastUpdateText = document.getElementById("lastUpdateText");
const mapsGrid = document.getElementById("mapsGrid");
const tableTopHeaderRow = document.getElementById("tableTopHeaderRow");
const tableSubHeaderRow = document.getElementById("tableSubHeaderRow");
const scoresTableBody = document.getElementById("scoresTableBody");
const excelTabsList = document.getElementById("excelTabsList");
const rulesView = document.getElementById("rulesView");

// DOM สำหรับสลับมุมมอง
const viewBtnLeaderboard = document.getElementById("viewBtnLeaderboard");
const viewBtnRaw = document.getElementById("viewBtnRaw");
const rawLockBadge = document.getElementById("rawLockBadge");
const leaderboardView = document.getElementById("leaderboardView");
const rawScoresView = document.getElementById("rawScoresView");
const rawLockedNotice = document.getElementById("rawLockedNotice");
const rawContent = document.getElementById("rawContent");
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
 * 1. เริ่มต้นระบบ โหลดสัปดาห์ทั้งหมด
 */
async function init() {
  if (!db) {
    scoresTableBody.innerHTML = `
      <tr>
        <td colspan="17" style="padding: 30px; text-align: center; color: #dc2626;">
          ⚠️ กรุณากรอก <strong>SUPABASE_URL</strong> และ <strong>SUPABASE_ANON_KEY</strong> ในไฟล์ <code>config.js</code> ก่อนใช้งาน
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
      scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 30px; text-align: center;">ยังไม่มีข้อมูลการแข่งขันในระบบ</td></tr>`;
      return;
    }

    allWeeks = weeks;
    renderBottomTabs();

    const defaultWeek = weeks.find((w) => w.is_active) || weeks[0];
    await selectWeek(defaultWeek.id);
  } catch (err) {
    console.error("Init Error:", err);
  }
}

/**
 * 2. สร้างแถบแท็บด้านล่าง (Excel / Google Sheets Style)
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
 * 3. เลือกสัปดาห์ที่จะดู
 */
async function selectWeek(weekId) {
  document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));
  const targetTab = document.getElementById(`tab-week-${weekId}`);
  if (targetTab) targetTab.classList.add("active");

  rulesView.style.display = "none";

  scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">กำลังโหลดข้อมูลและคำนวณคะแนน Phantom Score...</td></tr>`;

  const { data: week } = await db.from("weeks").select("*").eq("id", weekId).single();
  if (!week) return;
  currentWeek = week;

  // อัปเดตสถานะป้ายล็อคในแท็บสลับมุมมอง
  if (week.is_frozen) {
    rawLockBadge.textContent = "🔓 ปลดล็อกแล้ว";
    rawLockBadge.className = "lock-pill unlocked";
  } else {
    rawLockBadge.textContent = "🔒 จบวีคถึงจะดูได้";
    rawLockBadge.className = "lock-pill";
  }

  // อัปเดต Header Banner
  bannerTitle.textContent = `🏆 ${week.title}`;
  bannerSubInfo.textContent = week.header_info || (week.is_frozen ? "❄️ การแข่งขันสัปดาห์นี้สิ้นสุดแล้ว" : "🟢 กำลังแข่งขัน (อัปเดตทุก 30 นาที)");

  const updateDate = week.updated_at ? new Date(week.updated_at) : new Date();
  lastUpdateText.textContent = `${updateDate.toLocaleDateString("th-TH")} ${updateDate.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;

  // ดึง Challenges ทั้ง 7 Seeds
  const { data: challenges } = await db
    .from("challenges")
    .select("*")
    .eq("week_id", weekId)
    .order("seed_number", { ascending: true });

  currentChallenges = challenges || [];
  renderMapCards(currentChallenges);
  renderTableHeaders(currentChallenges);

  if (currentChallenges.length === 0) {
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 30px; text-align: center;">ยังไม่มีรายชื่อ Map สำหรับสัปดาห์นี้</td></tr>`;
    return;
  }

  // ดึงคะแนนทั้งหมดของ Week นี้
  const challengeIds = currentChallenges.map((c) => c.id);
  const { data: scores } = await db
    .from("scores")
    .select("*, players(id, username)")
    .in("challenge_id", challengeIds);

  calculateAndRenderScores(scores || [], currentChallenges);

  // อัปเดตมุมมองที่เปิดค้างอยู่
  switchMainView(currentMainView);
}

/**
 * 4. สลับมุมมองระหว่าง "ตารางคะแนนรวม" กับ "รายละเอียดคะแนนดิบ"
 */
window.switchMainView = function (viewName) {
  currentMainView = viewName;
  rulesView.style.display = "none";

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

    // ตรวจสอบว่าสัปดาห์นี้ Freeze หรือยัง
    if (!currentWeek?.is_frozen) {
      rawLockedNotice.style.display = "block";
      rawContent.style.display = "none";
    } else {
      rawLockedNotice.style.display = "none";
      rawContent.style.display = "block";
      renderRawScoresView();
    }
  }
};

/**
 * 5. สลับไปหน้าแท็บกฎกติกา (Rules)
 */
window.switchTab = function (tabName) {
  if (tabName === "rules") {
    document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));
    document.getElementById("tabRules").classList.add("active");
    leaderboardView.style.display = "none";
    rawScoresView.style.display = "none";
    rulesView.style.display = "block";
  }
};

/**
 * 6. วาดการ์ด 7 Maps ด้านบน
 */
function renderMapCards(challenges) {
  if (!challenges.length) {
    mapsGrid.innerHTML = `<div style="grid-column: span 7; color: white; text-align: center;">ไม่มีข้อมูล Map</div>`;
    return;
  }

  mapsGrid.innerHTML = challenges
    .map((c) => {
      return `
      <div class="map-card">
        <div>
          <div class="map-title">Map ${c.seed_number} 🔗</div>
          <div class="map-desc">${escapeHtml(c.name || `Seed ${c.seed_number}`)}</div>
        </div>
        <a href="${c.url}" target="_blank" rel="noopener noreferrer" class="map-btn">
          ▶ เล่น Challenge
        </a>
      </div>
    `;
    })
    .join("");
}

/**
 * 7. วาดส่วนหัวของตารางหลัก
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
 * 8. อัลกอริทึมคำนวณ Phantom Score (10% Threshold)
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
      // 1. คำนวณ Phantom Score ในแต่ละ Round (0..4 = R1..R5 เต็ม 5,000 / 5 = Total เต็ม 25,000)
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

      // 2. รวมคะแนนประจำ Map = ผลรวมคะแนนที่ได้รับจากทั้ง 6 Rounds ย่อย
      pList.forEach((p) => {
        p.ptsRounds = p.points.reduce((a, b) => a + b, 0);
        p.ptsMap = p.ptsRounds; // คะแนนในตารางคือผลรวมของ 6 Rounds
      });

      // 3. จัดอันดับใน Map (เรียงตาม ptsMap มากไปน้อย)
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

  // 4. สรุปคะแนนรวมทั้ง 7 Maps
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
    scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">ยังไม่มีผู้เล่นเล่นจบครบ 5 รอบในสัปดาห์นี้</td></tr>`;
    return;
  }

  // เรียงลำดับคะแนนรวมจากมากไปน้อย
  finalLeaderboard.sort((a, b) => b.grandTotal - a.grandTotal);

  for (let i = 0; i < finalLeaderboard.length; i++) {
    if (i > 0 && finalLeaderboard[i].grandTotal === finalLeaderboard[i - 1].grandTotal) {
      finalLeaderboard[i].overallRank = finalLeaderboard[i - 1].overallRank;
    } else {
      finalLeaderboard[i].overallRank = i + 1;
    }
  }

  // วาดแถวตารางหลัก (Leaderboard Table)
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

  // หากอยู่ในหน้าดูคะแนนดิบ ให้อัปเดตตารางคะแนนดิบด้วย
  if (currentMainView === "raw" && currentWeek?.is_frozen) {
    renderRawScoresView();
  }
}

/**
 * 9. วาดหน้าตารางคะแนนดิบแยกราย Round (Raw Scores Table)
 */
function renderRawScoresView() {
  if (!currentCalculatedData || !currentChallenges.length) return;

  const { mapResults, challenges } = currentCalculatedData;

  // วาด Pills เลือก Map 1 ถึง 7
  rawMapSelectorPills.innerHTML = challenges
    .map((c) => {
      const isSel = c.seed_number === selectedRawSeed;
      return `
        <button class="raw-map-pill ${isSel ? "active" : ""}" onclick="selectRawMapSeed(${c.seed_number})">
          🗺️ Map ${c.seed_number}: ${escapeHtml(c.name || `Seed ${c.seed_number}`)}
        </button>
      `;
    })
    .join("");

  // ดึงข้อมูล Map ที่เลือก
  const activeChallenge = challenges.find((c) => c.seed_number === selectedRawSeed) || challenges[0];
  const resultMap = mapResults.get(activeChallenge.id);

  if (!resultMap || resultMap.size === 0) {
    rawTableBody.innerHTML = `<tr><td colspan="9" style="padding: 30px; text-align: center; color: #64748b;">ยังไม่มีผู้เล่นใน Map นี้</td></tr>`;
    return;
  }

  // ดึงรายชื่อผู้เล่นและจัดอันดับตามคะแนนในแมพนี้
  const playersList = Array.from(resultMap.values()).sort((a, b) => b.ptsMap - a.ptsMap || b.raw[5] - a.raw[5]);

  rawTableBody.innerHTML = playersList
    .map((p) => {
      const rankDisplay = formatRankDisplay(p.rank);

      // สร้างช่อง R1 ถึง R5
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

      // ช่อง Total (25k)
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

init();
