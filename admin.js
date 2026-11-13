// ====================================================================
// GeoGuessr Weekly Challenge - Admin Script
// รองรับการแก้ไขสัปดาห์, ปลด Freeze, แก้ไข 7 Maps, ลบ และตั้งค่า
// ====================================================================

const loginGate = document.getElementById("loginGate");
const adminDashboard = document.getElementById("adminDashboard");
const loginForm = document.getElementById("loginForm");
const loginKeyInput = document.getElementById("loginKeyInput");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const createWeekForm = document.getElementById("createWeekForm");
const weeksList = document.getElementById("weeksList");

// Modal แก้ไข
const editWeekModal = document.getElementById("editWeekModal");
const editWeekForm = document.getElementById("editWeekForm");
const editWeekId = document.getElementById("editWeekId");
const editWeekTitle = document.getElementById("editWeekTitle");
const editWeekHeaderInfo = document.getElementById("editWeekHeaderInfo");
const editWeekEndDate = document.getElementById("editWeekEndDate");
const editMapsContainer = document.getElementById("editMapsContainer");

let adminDb = null;

// ตรวจสอบสถานะล็อกอินทันทีที่เปิดหน้า
async function checkAuth() {
  const savedKey = localStorage.getItem("llgg_admin_service_key") || "";
  if (!savedKey) {
    showLogin();
    return;
  }

  const result = await verifyKey(savedKey);
  if (result.ok) {
    showDashboard();
  } else {
    localStorage.removeItem("llgg_admin_service_key");
    showLogin();
  }
}

async function verifyKey(key) {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
    return { ok: false, error: "กรุณาตั้งค่า CONFIG.SUPABASE_URL ใน config.js ก่อนใช้งาน" };
  }

  try {
    const testDb = supabase.createClient(CONFIG.SUPABASE_URL, key);
    const { error } = await testDb.from("weeks").select("id").limit(1);
    if (error) {
      console.warn("Auth check error:", error.message);
      return { ok: false, error: `Supabase ปฏิเสธ: ${error.message}` };
    }
    adminDb = testDb;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function showLogin() {
  loginGate.style.display = "block";
  adminDashboard.style.display = "none";
}

function showDashboard() {
  loginGate.style.display = "none";
  adminDashboard.style.display = "block";
  loadWeeks();
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.style.display = "block";
}

// ฟอร์มเข้าสู่ระบบ
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.style.display = "none";

  const key = loginKeyInput.value.trim();
  if (!key) return;

  const result = await verifyKey(key);
  if (result.ok) {
    localStorage.setItem("llgg_admin_service_key", key);
    loginKeyInput.value = "";
    showDashboard();
  } else {
    showLoginError(`❌ ${result.error || "Key ไม่ถูกต้อง หรือไม่มีสิทธิ์เข้าถึง Supabase"}`);
  }
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("llgg_admin_service_key");
  adminDb = null;
  showLogin();
});

function extractToken(url) {
  if (!url) return "";
  const trimmed = url.trim();
  const match = trimmed.match(/(?:challenge\/|^)([a-zA-Z0-9_-]{10,32})/);
  return match ? match[1] : trimmed;
}

/**
 * 1. โหลดและแสดงรายการสัปดาห์ทั้งหมด (พร้อมปุ่มจัดการเต็มรูปแบบ)
 */
async function loadWeeks() {
  if (!adminDb) return;
  weeksList.innerHTML = `<p style="color: #64748b; padding: 12px;">กำลังโหลด...</p>`;

  const { data: weeks, error } = await adminDb
    .from("weeks")
    .select("*, challenges(*)")
    .order("id", { ascending: false });

  if (error || !weeks || weeks.length === 0) {
    weeksList.innerHTML = `<p style="color: #64748b; padding: 12px;">ยังไม่มีสัปดาห์ใด ๆ ในระบบ</p>`;
    return;
  }

  weeksList.innerHTML = weeks
    .map((w) => {
      const activeTag = w.is_active ? `<span style="background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">⭐️ สัปดาห์ปัจจุบัน (Active)</span>` : "";
      const frozenTag = w.is_frozen
        ? `<span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">❄️ Freeze แล้ว</span>`
        : `<span style="background: #fef3c7; color: #b45309; padding: 3px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">🟢 กำลังแข่ง</span>`;

      let endDateStr = "ไม่ได้กำหนด (แมนนวล)";
      if (w.end_date) {
        const d = new Date(w.end_date);
        endDateStr = `${d.toLocaleDateString("th-TH")} ${d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
      }

      const challengesList = (w.challenges || [])
        .sort((a, b) => a.seed_number - b.seed_number)
        .map((c) => `<span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">M${c.seed_number}: ${renderFlags(escapeHtml(c.name || c.token))}</span>`)
        .join(" ");

      return `
        <div class="week-card-item">
          <div class="week-header-row">
            <div>
              <strong style="font-size: 1.15rem; color: #0f172a;">${escapeHtml(w.title)}</strong>
              <div style="font-size: 0.85rem; color: #475569; margin: 4px 0;">${escapeHtml(w.header_info || "(ไม่มีข้อความหัวเว็บ)")}</div>
              <div style="font-size: 0.8rem; color: #64748b;">วันตัดรอบ: <strong>${endDateStr}</strong></div>
              <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                ${frozenTag}
                ${activeTag}
              </div>
            </div>
            
            <div class="week-actions">
              ${
                w.is_frozen
                  ? `<button class="btn btn-unfreeze" onclick="toggleFreeze(${w.id}, false)">🔓 ปลด Freeze (เปิดแข่งต่อ)</button>`
                  : `<button class="btn btn-freeze" onclick="toggleFreeze(${w.id}, true)">❄️ Freeze ทันที</button>`
              }
              <button class="btn" style="background: #0284c7; color: white;" onclick="openScoresModal(${w.id}, '${escapeHtml(w.title)}')">📊 จัดการคะแนน</button>
              <button class="btn btn-edit" onclick="openEditModal(${w.id})">✏️ แก้ไขข้อมูล & 7 Maps</button>
              ${
                !w.is_active
                  ? `<button class="btn" style="background: #475569;" onclick="setActiveWeek(${w.id})">⭐️ ตั้งเป็นหน้าแรก</button>`
                  : ""
              }
              <button class="btn btn-danger" onclick="deleteWeek(${w.id}, '${escapeHtml(w.title)}')">🗑️ ลบ</button>
            </div>
          </div>

          <div style="border-top: 1px dashed #cbd5e1; padding-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <strong style="font-size: 0.8rem; color: #64748b;">7 Maps:</strong>
            ${challengesList || "<span style='color: #94a3b8; font-size: 0.8rem;'>ยังไม่มี Maps</span>"}
          </div>
        </div>
      `;
    })
    .join("");
}

/**
 * 2. สลับสถานะ Freeze / Unfreeze
 */
window.toggleFreeze = async function (id, shouldFreeze) {
  if (!adminDb) return;
  const actionText = shouldFreeze ? "Freeze สัปดาห์นี้ (ปิดรับคะแนน)" : "ปลด Freeze (เปิดรับคะแนนต่อ)";
  if (!confirm(`คุณต้องการ ${actionText} ใช่หรือไม่?`)) return;

  try {
    const { error } = await adminDb
      .from("weeks")
      .update({ is_frozen: shouldFreeze })
      .eq("id", id);

    if (error) throw error;
    loadWeeks();
  } catch (err) {
    alert("เกิดข้อผิดพลาด: " + err.message);
  }
};

/**
 * 3. เปิด Modal แก้ไขสัปดาห์ & 7 Maps
 */
window.openEditModal = async function (weekId) {
  if (!adminDb) return;

  const { data: week, error: wErr } = await adminDb
    .from("weeks")
    .select("*, challenges(*)")
    .eq("id", weekId)
    .single();

  if (wErr || !week) {
    alert("ไม่พบข้อมูลสัปดาห์นี้");
    return;
  }

  editWeekId.value = week.id;
  editWeekTitle.value = week.title || "";
  editWeekHeaderInfo.value = week.header_info || "";

  // แปลง end_date เป็น format สำหรับ input datetime-local
  if (week.end_date) {
    const d = new Date(week.end_date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    editWeekEndDate.value = d.toISOString().slice(0, 16);
  } else {
    editWeekEndDate.value = "";
  }

  // เตรียมข้อมูล 7 Maps
  const challenges = (week.challenges || []).sort((a, b) => a.seed_number - b.seed_number);
  
  editMapsContainer.innerHTML = [1, 2, 3, 4, 5, 6, 7]
    .map((seedNum) => {
      const ch = challenges.find((c) => c.seed_number === seedNum) || {};
      return `
        <div class="map-row">
          <strong>Map ${seedNum}:</strong>
          <input type="text" class="edit-map-name" data-seed="${seedNum}" placeholder="ชื่อแมพ & โหมด" value="${escapeHtml(ch.name || "")}" required>
          <input type="text" class="edit-map-url" data-seed="${seedNum}" placeholder="ลิงก์ Challenge" value="${escapeHtml(ch.url || (ch.token ? `https://www.geoguessr.com/challenge/${ch.token}` : ""))}" required>
        </div>
      `;
    })
    .join("");

  editWeekModal.classList.add("open");
};

window.closeEditModal = function () {
  editWeekModal.classList.remove("open");
};

// บันทึกการแก้ไขสัปดาห์
editWeekForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!adminDb) return;

  const weekId = Number(editWeekId.value);
  const title = editWeekTitle.value.trim();
  const headerInfo = editWeekHeaderInfo.value.trim();
  const endDateVal = editWeekEndDate.value;
  const endDate = endDateVal ? new Date(endDateVal).toISOString() : null;

  const nameInputs = document.querySelectorAll(".edit-map-name");
  const urlInputs = document.querySelectorAll(".edit-map-url");
  const challengesToUpsert = [];

  for (let i = 0; i < 7; i++) {
    const seedNum = i + 1;
    const name = nameInputs[i].value.trim();
    const rawUrl = urlInputs[i].value.trim();
    const token = extractToken(rawUrl);

    if (!token) {
      alert(`ลิงก์สำหรับ Map ${seedNum} ไม่ถูกต้อง`);
      return;
    }

    challengesToUpsert.push({
      week_id: weekId,
      seed_number: seedNum,
      name: name || `Map ${seedNum}`,
      token: token,
      url: rawUrl.startsWith("http") ? rawUrl : `https://www.geoguessr.com/challenge/${token}`,
    });
  }

  try {
    // 0. ตรวจสอบการเปลี่ยน Token ของแต่ละ Map ว่ามีคะแนนเดิมค้างอยู่หรือไม่
    const { data: existingChallenges, error: exErr } = await adminDb
      .from("challenges")
      .select("id, seed_number, token, name")
      .eq("week_id", weekId);

    if (exErr) throw exErr;

    const mapsWithChangedToken = [];
    if (existingChallenges && existingChallenges.length > 0) {
      for (const ch of challengesToUpsert) {
        const oldCh = existingChallenges.find((ec) => ec.seed_number === ch.seed_number);
        if (oldCh && oldCh.token !== ch.token) {
          // มีการเปลี่ยนโทเคน -> ตรวจสอบว่าแมพเก่ามีคะแนนบันทึกอยู่หรือไม่
          const { count, error: countErr } = await adminDb
            .from("scores")
            .select("*", { count: "exact", head: true })
            .eq("challenge_id", oldCh.id);

          if (!countErr && count > 0) {
            mapsWithChangedToken.push({
              oldId: oldCh.id,
              seed: ch.seed_number,
              name: oldCh.name || `Map ${ch.seed_number}`,
              count: count,
            });
          }
        }
      }
    }

    // ถ้าตรวจพบคะแนนเดิมในแมพที่เปลี่ยน Token ให้เตือน Admin ยืนยันการล้างคะแนนเก่า
    if (mapsWithChangedToken.length > 0) {
      const warningList = mapsWithChangedToken
        .map((m) => `• Map ${m.seed} (${m.name}): มีคะแนนเดิมค้างอยู่ ${m.count} รายการ`)
        .join("\n");

      const confirmMsg =
        `⚠️ มีการเปลี่ยนลิงก์ Challenge Token ในแมพต่อไปนี้:\n\n` +
        warningList +
        `\n\nการเปลี่ยนลิงก์คือการเปลี่ยน seed การแข่งขันใหม่ คะแนนเดิมของแมพเหล่านี้จะไม่สามารถนำมารวมกับผู้เล่นใน seed ใหม่ได้ จึงต้องถูกล้างออก\n\nคุณยืนยันที่จะเปลี่ยนลิงก์และล้างคะแนนเดิมของแมพเหล่านี้หรือไม่?`;

      if (!confirm(confirmMsg)) {
        return; // ยกเลิก ไม่บันทึก
      }

      // ดำเนินการลบคะแนนของแมพที่เปลี่ยน token
      for (const m of mapsWithChangedToken) {
        await adminDb.from("scores").delete().eq("challenge_id", m.oldId);
      }
    }

    // 1. อัปเดตข้อมูลสัปดาห์
    const { error: wErr } = await adminDb
      .from("weeks")
      .update({
        title,
        header_info: headerInfo,
        end_date: endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", weekId);

    if (wErr) throw wErr;

    // 2. อัปเดตข้อมูลทั้ง 7 Challenges
    const { error: chErr } = await adminDb
      .from("challenges")
      .upsert(challengesToUpsert, { onConflict: "week_id,seed_number" });

    if (chErr) throw chErr;

    alert(
      "✅ บันทึกการแก้ไขสัปดาห์และ 7 Maps เรียบร้อยแล้ว!" +
        (mapsWithChangedToken.length > 0 ? "\n(ล้างคะแนนเก่าของ Map ที่เปลี่ยนลิงก์เรียบร้อยแล้ว)" : "")
    );
    closeEditModal();
    loadWeeks();
  } catch (err) {
    console.error("Edit Week Error:", err);
    alert("เกิดข้อผิดพลาด: " + err.message);
  }
});

/**
 * 4. สร้างสัปดาห์ใหม่พร้อม 7 Maps
 */
createWeekForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!adminDb) {
    alert("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    showLogin();
    return;
  }

  const title = document.getElementById("weekTitle").value.trim();
  const headerInfo = document.getElementById("weekHeaderInfo").value.trim();
  const endDateVal = document.getElementById("weekEndDate").value;
  const endDate = endDateVal ? new Date(endDateVal).toISOString() : null;

  const mapNameInputs = document.querySelectorAll(".map-name-input");
  const mapUrlInputs = document.querySelectorAll(".map-url-input");
  const challengesData = [];

  for (let i = 0; i < 7; i++) {
    const seedNum = i + 1;
    const name = mapNameInputs[i].value.trim();
    const rawUrl = mapUrlInputs[i].value.trim();
    const token = extractToken(rawUrl);

    if (!token) {
      alert(`ลิงก์สำหรับ Map ${seedNum} ไม่ถูกต้อง`);
      return;
    }

    challengesData.push({
      seed_number: seedNum,
      name: name || `Map ${seedNum}`,
      token: token,
      url: rawUrl.startsWith("http") ? rawUrl : `https://www.geoguessr.com/challenge/${token}`,
    });
  }

  try {
    // 1. ตั้งสัปดาห์อื่น ๆ เป็น is_active = false
    await adminDb.from("weeks").update({ is_active: false }).neq("id", 0);

    // 2. สร้างสัปดาห์ใหม่
    const { data: newWeek, error: wErr } = await adminDb
      .from("weeks")
      .insert({
        title,
        header_info: headerInfo,
        end_date: endDate,
        is_active: true,
        is_frozen: false,
      })
      .select()
      .single();

    if (wErr) throw wErr;

    // 3. แทรก 7 Challenges
    const challengesToInsert = challengesData.map((c) => ({
      week_id: newWeek.id,
      seed_number: c.seed_number,
      name: c.name,
      token: c.token,
      url: c.url,
    }));

    const { error: chErr } = await adminDb.from("challenges").insert(challengesToInsert);
    if (chErr) throw chErr;

    alert(`✅ สร้างสัปดาห์ "${title}" พร้อม 7 Maps สำเร็จแล้ว!`);
    createWeekForm.reset();
    loadWeeks();
  } catch (err) {
    console.error("Error creating week:", err);
    alert("เกิดข้อผิดพลาด: " + err.message);
  }
});

window.setActiveWeek = async function (id) {
  if (!adminDb) return;
  await adminDb.from("weeks").update({ is_active: false }).neq("id", 0);
  await adminDb.from("weeks").update({ is_active: true }).eq("id", id);
  loadWeeks();
};

window.deleteWeek = async function (id, title) {
  if (!adminDb) return;
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบสัปดาห์ "${title}"? ข้อมูลคะแนนทั้งหมดจะหายไป`)) return;
  await adminDb.from("weeks").delete().eq("id", id);
  loadWeeks();
};

function renderFlags(text) {
  if (!text) return "";
  text = text
    .replace(/\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F/g,
      '<img class="flag-icon" src="https://flagcdn.com/24x18/gb-eng.png" srcset="https://flagcdn.com/48x36/gb-eng.png 2x" width="20" height="15" alt="ENG" loading="lazy">')
    .replace(/\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74\uDB40\uDC7F/g,
      '<img class="flag-icon" src="https://flagcdn.com/24x18/gb-sct.png" srcset="https://flagcdn.com/48x36/gb-sct.png 2x" width="20" height="15" alt="SCT" loading="lazy">')
    .replace(/\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F/g,
      '<img class="flag-icon" src="https://flagcdn.com/24x18/gb-wls.png" srcset="https://flagcdn.com/48x36/gb-wls.png 2x" width="20" height="15" alt="WLS" loading="lazy">');

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

// ==========================================
// 5. จัดการคะแนนผู้เล่น (Score Manager)
// ==========================================
let currentScoresWeekId = null;
let currentWeekChallenges = [];
let currentWeekScores = [];

window.openScoresModal = async function (weekId, weekTitle) {
  currentScoresWeekId = weekId;
  const modal = document.getElementById("scoresModal");
  document.getElementById("scoresModalTitle").textContent = `📊 จัดการคะแนนผู้เล่น`;
  document.getElementById("scoresModalSubtitle").textContent = `สัปดาห์: ${weekTitle || `Week ${weekId}`}`;
  document.getElementById("scoresSearchInput").value = "";
  document.getElementById("scoresFilterMap").value = "all";

  modal.classList.add("open");
  await loadScoresForWeek(weekId);
};

window.closeScoresModal = function () {
  document.getElementById("scoresModal").classList.remove("open");
};

async function loadScoresForWeek(weekId) {
  if (!adminDb) return;
  const tbody = document.getElementById("scoresTableBody");
  tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: #64748b;">⏳ กำลังโหลดข้อมูลคะแนน...</td></tr>`;

  try {
    // 1. ดึง Challenges ทั้งหมดของสัปดาห์นี้
    const { data: challenges, error: chErr } = await adminDb
      .from("challenges")
      .select("id, seed_number, name")
      .eq("week_id", weekId)
      .order("seed_number", { ascending: true });

    if (chErr) throw chErr;
    currentWeekChallenges = challenges || [];

    if (currentWeekChallenges.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: #94a3b8;">ไม่พบข้อมูล Map ในสัปดาห์นี้</td></tr>`;
      return;
    }

    const chIds = currentWeekChallenges.map((c) => c.id);

    // 2. ดึงคะแนนทั้งหมดของ Challenges ในสัปดาห์นี้ พร้อมข้อมูล players
    const { data: scores, error: scErr } = await adminDb
      .from("scores")
      .select("id, challenge_id, player_id, total_score, r1, r2, r3, r4, r5, players(id, username)")
      .in("challenge_id", chIds)
      .order("total_score", { ascending: false });

    if (scErr) throw scErr;
    currentWeekScores = scores || [];

    renderScoresList();
  } catch (err) {
    console.error("Load Scores Error:", err);
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: red; padding: 24px;">เกิดข้อผิดพลาดในการโหลดคะแนน: ${escapeHtml(err.message)}</td></tr>`;
  }
}

window.renderScoresList = function () {
  const mapFilter = document.getElementById("scoresFilterMap").value;
  const searchFilter = (document.getElementById("scoresSearchInput").value || "").trim().toLowerCase();
  const tbody = document.getElementById("scoresTableBody");

  const chMap = {};
  currentWeekChallenges.forEach((c) => {
    chMap[c.id] = c;
  });

  const filtered = currentWeekScores.filter((s) => {
    const ch = chMap[s.challenge_id];
    if (mapFilter !== "all") {
      if (!ch || String(ch.seed_number) !== mapFilter) return false;
    }
    if (searchFilter) {
      const uName = (s.players?.username || "").toLowerCase();
      if (!uName.includes(searchFilter)) return false;
    }
    return true;
  });

  document.getElementById("scoresTotalCount").textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px; color: #94a3b8;">ไม่พบคะแนนที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((s, idx) => {
      const ch = chMap[s.challenge_id] || { seed_number: "?", name: "Unknown" };
      const username = s.players?.username || `Player #${s.player_id}`;
      const total = s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));

      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="text-align: center; padding: 8px; color: #64748b;">${idx + 1}</td>
          <td style="padding: 8px 12px; font-weight: bold; color: #1e293b;">${escapeHtml(username)}</td>
          <td style="text-align: center; padding: 8px;">
            <span style="display: inline-block; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 0.78rem; font-weight: 600;">
              Map ${ch.seed_number}
            </span>
            <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${renderFlags(escapeHtml(ch.name || ""))}</div>
          </td>
          <td style="text-align: center; padding: 8px; color: #475569;">${(s.r1 ?? 0).toLocaleString()}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${(s.r2 ?? 0).toLocaleString()}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${(s.r3 ?? 0).toLocaleString()}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${(s.r4 ?? 0).toLocaleString()}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${(s.r5 ?? 0).toLocaleString()}</td>
          <td style="text-align: center; padding: 8px; font-weight: bold; background: #f8fafc; color: #00247d;">
            ${total.toLocaleString()}
          </td>
          <td style="text-align: center; padding: 8px;">
            <div style="display: flex; gap: 4px; justify-content: center;">
              <button class="btn btn-delete-score" onclick="deleteScore(${s.id})" title="ลบคะแนนแมพนี้เฉพาะรายการนี้">
                🗑️ ลบแมพนี้
              </button>
              <button class="btn btn-dq" onclick="disqualifyPlayerByScore(${s.id})" title="ตัดสิทธิ์ผู้เล่นคนนี้ ล้างคะแนนทุกแมพในสัปดาห์นี้">
                🚫 DQ วีคนี้
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
};

window.deleteScore = async function (scoreId) {
  if (!adminDb) return;
  const s = currentWeekScores.find((x) => x.id === scoreId);
  const ch = currentWeekChallenges.find((c) => c.id === s?.challenge_id);
  const pseudo = s?.players?.username || "ผู้เล่น";
  const mapName = ch ? `Map ${ch.seed_number}` : "แมพนี้";

  if (!confirm(`คุณต้องการลบคะแนนของ "${pseudo}" ใน ${mapName} ใช่หรือไม่?`)) return;

  try {
    const { error } = await adminDb.from("scores").delete().eq("id", scoreId);
    if (error) throw error;
    currentWeekScores = currentWeekScores.filter((x) => x.id !== scoreId);
    renderScoresList();
  } catch (err) {
    console.error("Delete score error:", err);
    alert("เกิดข้อผิดพลาดในการลบคะแนน: " + err.message);
  }
};

window.disqualifyPlayerByScore = async function (scoreId) {
  if (!adminDb) return;
  const s = currentWeekScores.find((x) => x.id === scoreId);
  if (!s) return;
  const pseudo = s.players?.username || `ID ${s.player_id}`;
  const playerId = s.player_id;

  const countPlayerScores = currentWeekScores.filter((x) => x.player_id === playerId).length;

  if (
    !confirm(
      `⚠️ ยืนยันการตัดสิทธิ์ (Disqualify) ผู้เล่น "${pseudo}" หรือไม่?\n\nระบบจะลบคะแนนทั้งหมดของผู้เล่นคนนี้ในสัปดาห์นี้ (${countPlayerScores} แมพ) ออกทันที`
    )
  )
    return;

  try {
    const chIds = currentWeekChallenges.map((c) => c.id);
    const { error } = await adminDb
      .from("scores")
      .delete()
      .eq("player_id", playerId)
      .in("challenge_id", chIds);

    if (error) throw error;
    currentWeekScores = currentWeekScores.filter((x) => x.player_id !== playerId);
    renderScoresList();
    alert(`✅ ตัดสิทธิ์และล้างคะแนนของ "${pseudo}" ในสัปดาห์นี้เรียบร้อยแล้ว`);
  } catch (err) {
    console.error("DQ player error:", err);
    alert("เกิดข้อผิดพลาดในการตัดสิทธิ์ผู้เล่น: " + err.message);
  }
};

// ==========================================
// 6. เพิ่ม / แก้ไขคะแนนด้วยมือ (Manual Scores)
// ==========================================
window.openManualScoreForm = function () {
  if (!currentScoresWeekId || currentWeekChallenges.length === 0) {
    alert("ไม่พบข้อมูล Map สำหรับสัปดาห์นี้");
    return;
  }
  const select = document.getElementById("manualMapSelect");
  select.innerHTML = currentWeekChallenges
    .map((c) => `<option value="${c.id}">Map ${c.seed_number}: ${escapeHtml(c.name || "")}</option>`)
    .join("");

  document.getElementById("manualUsername").value = "";
  document.getElementById("manualR1").value = "0";
  document.getElementById("manualR2").value = "0";
  document.getElementById("manualR3").value = "0";
  document.getElementById("manualR4").value = "0";
  document.getElementById("manualR5").value = "0";
  calcManualTotal();

  document.getElementById("manualScoreModal").classList.add("open");
};

window.closeManualScoreModal = function () {
  document.getElementById("manualScoreModal").classList.remove("open");
};

window.calcManualTotal = function () {
  const r1 = parseInt(document.getElementById("manualR1").value, 10) || 0;
  const r2 = parseInt(document.getElementById("manualR2").value, 10) || 0;
  const r3 = parseInt(document.getElementById("manualR3").value, 10) || 0;
  const r4 = parseInt(document.getElementById("manualR4").value, 10) || 0;
  const r5 = parseInt(document.getElementById("manualR5").value, 10) || 0;
  const total = r1 + r2 + r3 + r4 + r5;
  document.getElementById("manualTotalScore").textContent = total.toLocaleString();
};

const manualScoreForm = document.getElementById("manualScoreForm");
if (manualScoreForm) {
  manualScoreForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!adminDb) return;

    const challengeId = Number(document.getElementById("manualMapSelect").value);
    const username = document.getElementById("manualUsername").value.trim();
    const r1 = Math.min(5000, Math.max(0, parseInt(document.getElementById("manualR1").value, 10) || 0));
    const r2 = Math.min(5000, Math.max(0, parseInt(document.getElementById("manualR2").value, 10) || 0));
    const r3 = Math.min(5000, Math.max(0, parseInt(document.getElementById("manualR3").value, 10) || 0));
    const r4 = Math.min(5000, Math.max(0, parseInt(document.getElementById("manualR4").value, 10) || 0));
    const r5 = Math.min(5000, Math.max(0, parseInt(document.getElementById("manualR5").value, 10) || 0));
    const total = r1 + r2 + r3 + r4 + r5;

    if (!username) {
      alert("กรุณากรอกชื่อผู้เล่น");
      return;
    }

    try {
      // 1. ค้นหาผู้เล่นเดิม หรือสร้าง ID จำลองสำหรับผู้เล่นนี้
      let playerId = null;
      const { data: existingPlayers } = await adminDb
        .from("players")
        .select("id, username")
        .ilike("username", username)
        .limit(1);

      if (existingPlayers && existingPlayers.length > 0) {
        playerId = existingPlayers[0].id;
      } else {
        playerId = "manual_" + Math.random().toString(36).substring(2, 8) + Date.now().toString(36);
        const { error: pErr } = await adminDb.from("players").insert({
          id: playerId,
          username: username,
          updated_at: new Date().toISOString(),
        });
        if (pErr) throw pErr;
      }

      // 2. บันทึกคะแนนลงตาราง scores (upsert)
      const { error: sErr } = await adminDb.from("scores").upsert(
        {
          challenge_id: challengeId,
          player_id: playerId,
          r1,
          r2,
          r3,
          r4,
          r5,
          total_score: total,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "challenge_id,player_id" }
      );

      if (sErr) throw sErr;

      alert(`✅ บันทึกคะแนนของ "${username}" เรียบร้อยแล้ว! (Total: ${total.toLocaleString()})`);
      closeManualScoreModal();
      await loadScoresForWeek(currentScoresWeekId);
    } catch (err) {
      console.error("Save manual score error:", err);
      alert("เกิดข้อผิดพลาดในการบันทึกคะแนน: " + err.message);
    }
  });
}

checkAuth();
