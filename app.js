// ====================================================================
// GeoGuessr Weekly Challenge - Frontend App Logic
// ระบบคำนวณ Phantom Score (10% Missing-Score Threshold)
// สไตล์ Google Sheets / Excel Dashboard
// ====================================================================

let db = null;
let allWeeks = [];
let currentWeek = null;
let currentChallenges = [];
let currentCalculatedData = null; // เก็บผลลัพธ์คำนวณทั้งหมดสำหรับ Modal

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
const tableWrapper = document.querySelector(".table-wrapper");

// Modal DOM
const detailModal = document.getElementById("detailModal");
const modalPlayer = document.getElementById("modalPlayer");
const modalMapName = document.getElementById("modalMapName");
const modalRoundsList = document.getElementById("modalRoundsList");
const modalMapPoints = document.getElementById("modalMapPoints");

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

    // เลือกสัปดาห์ที่เป็น Active หรือสัปดาห์ล่าสุด
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

  // แทรกหลังแท็บ Rules
  const rulesTab = document.getElementById("tabRules");
  excelTabsList.innerHTML = "";
  excelTabsList.appendChild(rulesTab);
  excelTabsList.insertAdjacentHTML("beforeend", tabsHtml);
}

/**
 * 3. เลือกสัปดาห์ที่จะดู
 */
async function selectWeek(weekId) {
  // สลับแท็บ
  document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));
  const targetTab = document.getElementById(`tab-week-${weekId}`);
  if (targetTab) targetTab.classList.add("active");

  // แสดงตาราง ซ่อนหน้า Rules
  rulesView.style.display = "none";
  tableWrapper.style.display = "block";

  scoresTableBody.innerHTML = `<tr><td colspan="17" style="padding: 40px; text-align: center; color: #64748b;">กำลังโหลดข้อมูลและคำนวณคะแนน Phantom Score...</td></tr>`;

  // ดึงข้อมูล Week
  const { data: week } = await db.from("weeks").select("*").eq("id", weekId).single();
  if (!week) return;
  currentWeek = week;

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
}

/**
 * 4. สลับไปหน้าแท็บกฎกติกา (Rules)
 */
window.switchTab = function (tabName) {
  if (tabName === "rules") {
    document.querySelectorAll(".excel-tab").forEach((t) => t.classList.remove("active"));
    document.getElementById("tabRules").classList.add("active");
    tableWrapper.style.display = "none";
    rulesView.style.display = "block";
  }
};

/**
 * 5. วาดการ์ด 7 Maps ด้านบน
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
 * 6. วาดส่วนหัวของตาราง (Colspan 2 สำหรับแต่ละ Map)
 */
function renderTableHeaders(challenges) {
  // ล้างคอลัมน์เก่าออก เหลือ Position, Pseudo, Points
  tableTopHeaderRow.innerHTML = `
    <th class="col-pos" rowspan="2">Position</th>
    <th class="col-player" rowspan="2">Pseudo</th>
    <th class="col-total" rowspan="2">Points</th>
  `;
  tableSubHeaderRow.innerHTML = ``;

  challenges.forEach((c) => {
    // หัวบน
    const thTop = document.createElement("th");
    thTop.colSpan = 2;
    thTop.className = `th-top-map m${c.seed_number}`;
    thTop.textContent = `Map ${c.seed_number}`;
    tableTopHeaderRow.appendChild(thTop);

    // หัวล่าง
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
 * 7. อัลกอริทึมคำนวณ Phantom Score (10% Threshold) ตามกฎลีก LLGG / Cactus
 */
function calculateAndRenderScores(scores, challenges) {
  // รวบรวมผู้เล่นในแต่ละ Map
  // mapId -> [ { userId, username, raw: [r1, r2, r3, r4, r5, total] } ]
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

  // ผลลัพธ์คำนวณแต่ละ Map: challengeId -> Map(userId -> { ptsMap, rank, roundsDetail })
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
          // คะแนนที่ได้ใน Round นั้น = จำนวนผู้เล่นที่มีคะแนนดิบ <= Phantom Score ของเรา
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

  // 4. สรุปคะแนนรวมทั้ง 7 Maps ของผู้เล่นแต่ละคน
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

  // คำนวณ Overall Rank (พร้อมอันดับร่วม)
  for (let i = 0; i < finalLeaderboard.length; i++) {
    if (i > 0 && finalLeaderboard[i].grandTotal === finalLeaderboard[i - 1].grandTotal) {
      finalLeaderboard[i].overallRank = finalLeaderboard[i - 1].overallRank;
    } else {
      finalLeaderboard[i].overallRank = i + 1;
    }
  }

  // วาดแถวข้อมูลลงตาราง HTML
  scoresTableBody.innerHTML = finalLeaderboard
    .map((p) => {
      const posDisplay = formatRankDisplay(p.overallRank);

      // สร้างคอลัมน์ Points & Rank ของทั้ง 7 Maps
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
          const isFrozen = currentWeek?.is_frozen;

          return `
            <td class="col-pts ${isFrozen ? "clickable-cell" : ""}" 
                title="${isFrozen ? "คลิกเพื่อดูคะแนนดิบ 6 Rounds" : "กำลังแข่งขัน (คะแนนดิบจะเปิดให้ดูเมื่อจบสัปดาห์)"}" 
                onclick="handleCellClick('${p.userId}', ${c.id}, ${c.seed_number})">
              ${formatNum(mData.ptsMap)}
            </td>
            <td class="col-rank ${isFrozen ? "clickable-cell" : ""}" 
                onclick="handleCellClick('${p.userId}', ${c.id}, ${c.seed_number})">
              ${rankDisplay}
            </td>
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
}

/**
 * 8. คลิกดูรายละเอียดคะแนนดิบราย Round
 */
window.handleCellClick = function (userId, challengeId, seedNum) {
  if (!currentWeek?.is_frozen) {
    alert("🔒 คะแนนดิบรายรอบจะเปิดให้ดูอย่างละเอียดเมื่อจบสัปดาห์ (Freeze) แล้วครับ");
    return;
  }

  const { mapResults, challenges, playerNames } = currentCalculatedData;
  const pData = mapResults.get(challengeId)?.get(userId);
  if (!pData) return;

  const challenge = challenges.find((c) => c.id === challengeId);

  modalPlayer.textContent = playerNames.get(userId) || "Player";
  modalMapName.textContent = `Map ${seedNum} : ${challenge?.name || `Seed ${seedNum}`}`;
  modalMapPoints.textContent = `${formatNum(pData.ptsMap)} แต้ม (อันดับ ${pData.rank})`;

  const roundNames = ["Round 1", "Round 2", "Round 3", "Round 4", "Round 5", "Total (25k)"];

  modalRoundsList.innerHTML = pData.raw
    .map((rawVal, idx) => {
      const isTotal = idx === 5;
      const phantomVal = Math.round(pData.phantoms[idx]);
      const pts = pData.points[idx];

      return `
      <div class="round-row ${isTotal ? "total-row" : ""}">
        <span>${roundNames[idx]}</span>
        <span style="text-align: right;">${formatNum(rawVal)}</span>
        <span style="text-align: right; color: #0284c7;">${formatNum(phantomVal)}</span>
        <span style="text-align: right; font-weight: bold;">+${formatNum(pts)}</span>
      </div>
    `;
    })
    .join("");

  detailModal.classList.add("open");
};

window.closeDetailModal = function () {
  detailModal.classList.remove("open");
};

detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeDetailModal();
});

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

init();
