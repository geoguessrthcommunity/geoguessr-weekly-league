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
              <button class="btn" style="background: #0d9488; color: white;" onclick="openMapInspectorModal(${w.id}, '${escapeHtml(w.title)}')">🧮 ตรวจการคิดคะแนน</button>
              <button class="btn" style="background: #7c3aed; color: white;" onclick="openAdjustmentsModal(${w.id}, '${escapeHtml(w.title)}')">🛠️ กฎคะแนนพิเศษ</button>
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

// ==========================================
// 7. สั่ง Force Sync ทันที (Force Sync Trigger)
// ==========================================
window.triggerForceSync = async function () {
  if (!adminDb) return;
  const btn = document.getElementById("forceSyncBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `⏳ กำลังส่งคำขอ...`;

  try {
    const { data: req, error } = await adminDb
      .from("sync_requests")
      .insert({ status: "pending", requested_by: "admin" })
      .select()
      .single();

    if (error) throw error;

    btn.innerHTML = `🔄 กำลังดึงคะแนน...`;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const { data: check } = await adminDb
        .from("sync_requests")
        .select("status")
        .eq("id", req.id)
        .single();

      if (check && check.status === "completed") {
        clearInterval(interval);
        btn.innerHTML = `✅ Sync สำเร็จ!`;
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 3000);
        loadWeeks();
        alert("✅ ดึงข้อมูลคะแนนล่าสุดเรียบร้อยแล้ว!");
      } else if (check && check.status === "failed") {
        clearInterval(interval);
        btn.innerHTML = `❌ Sync ล้มเหลว`;
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 3000);
        alert("❌ เกิดข้อผิดพลาดขณะรัน Sync กรุณาตรวจสอบ logs");
      } else if (attempts >= 10) {
        clearInterval(interval);
        btn.innerHTML = originalText;
        btn.disabled = false;
        alert(
          "📡 ส่งคำขอ Sync ไปยังระบบเรียบร้อยแล้ว!\n\n(หากคุณรัน start-sync.bat ในเครื่อง บอทจะดึงคะแนนให้ทันที หรือหากใช้ GitHub Actions ระบบจะรันตามรอบ 30 นาทีอัตโนมัติ)"
        );
      }
    }, 2000);
  } catch (err) {
    btn.innerHTML = originalText;
    btn.disabled = false;
    alert("เกิดข้อผิดพลาด: " + err.message);
  }
};

// ==========================================
// 8. ส่งออกคะแนนทั้งหมด Master CSV (Export CSV)
// ==========================================
window.exportMasterCSV = async function () {
  if (!adminDb) return;
  try {
    const { data: scores, error } = await adminDb
      .from("scores")
      .select("*, challenges(*, weeks(*)), players(username)")
      .order("id", { ascending: false });

    if (error) throw error;
    if (!scores || scores.length === 0) {
      alert("ยังไม่มีข้อมูลคะแนนในระบบที่จะส่งออก");
      return;
    }

    const headers = [
      "Week Title",
      "Week Status",
      "Map Number",
      "Map Name",
      "Player Pseudo",
      "Player User ID",
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5",
      "Total Score (25k)",
      "Updated At",
    ];

    const rows = scores.map((s) => {
      const wk = s.challenges?.weeks || {};
      const ch = s.challenges || {};
      const uName = s.players?.username || "Unknown";
      const total =
        s.total_score ??
        ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));

      return [
        `"${(wk.title || "").replace(/"/g, '""')}"`,
        `"${wk.is_frozen ? "Frozen" : "Active"}"`,
        `"Map ${ch.seed_number || ""}"`,
        `"${(ch.name || "").replace(/"/g, '""')}"`,
        `"${uName.replace(/"/g, '""')}"`,
        `"${s.player_id}"`,
        s.r1 ?? 0,
        s.r2 ?? 0,
        s.r3 ?? 0,
        s.r4 ?? 0,
        s.r5 ?? 0,
        total,
        `"${s.updated_at || ""}"`,
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `geoguessr_master_scores_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert("เกิดข้อผิดพลาดในการส่งออกข้อมูล: " + err.message);
  }
};

// ==========================================
// 9. กฎปรับคะแนนพิเศษ (Score Adjustments)
// ==========================================
let currentAdjWeekId = null;
let currentAdjChallenges = [];

window.openAdjustmentsModal = async function (weekId, weekTitle) {
  if (!adminDb) return;
  currentAdjWeekId = weekId;
  const modal = document.getElementById("adjustmentsModal");
  document.getElementById("adjModalTitle").textContent = "🛠️ กฎปรับคะแนนพิเศษ (Score Adjustments)";
  document.getElementById("adjModalSubtitle").textContent = `สัปดาห์: ${weekTitle || `Week ${weekId}`}`;
  modal.classList.add("open");

  const { data: challenges } = await adminDb
    .from("challenges")
    .select("id, seed_number, name")
    .eq("week_id", weekId)
    .order("seed_number", { ascending: true });

  currentAdjChallenges = challenges || [];
  const mapSelect = document.getElementById("adjMapSelect");
  mapSelect.innerHTML = currentAdjChallenges
    .map((c) => `<option value="${c.id}">Map ${c.seed_number}: ${escapeHtml(c.name || `Map ${c.seed_number}`)}</option>`)
    .join("");

  updateRuleInputsVisibility();
  await loadActiveAdjustments(weekId);
};

window.closeAdjustmentsModal = function () {
  document.getElementById("adjustmentsModal")?.classList.remove("open");
};

window.updateRuleInputsVisibility = function () {
  const ruleType = document.getElementById("adjRuleType").value;
  const minCont = document.getElementById("adjMinScoreContainer");
  const targetCont = document.getElementById("adjTargetScoreContainer");
  const bonusCont = document.getElementById("adjBonusContainer");

  if (ruleType === "threshold_to_max") {
    minCont.style.display = "block";
    targetCont.style.display = "block";
    bonusCont.style.display = "none";
  } else if (ruleType === "void_round") {
    minCont.style.display = "none";
    targetCont.style.display = "block";
    bonusCont.style.display = "none";
  } else if (ruleType === "bonus_points") {
    minCont.style.display = "none";
    targetCont.style.display = "none";
    bonusCont.style.display = "block";
  }
};

async function loadActiveAdjustments(weekId) {
  const tbody = document.getElementById("adjListTableBody");
  tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #64748b;">กำลังโหลดกฎ...</td></tr>`;

  try {
    const chIds = currentAdjChallenges.map((c) => c.id);
    if (chIds.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center;">ไม่พบแมพในสัปดาห์นี้</td></tr>`;
      return;
    }

    const { data: adjustments, error } = await adminDb
      .from("score_adjustments")
      .select("*")
      .in("challenge_id", chIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!adjustments || adjustments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #94a3b8;">ยังไม่มีกฎปรับคะแนนในสัปดาห์นี้</td></tr>`;
      return;
    }

    tbody.innerHTML = adjustments
      .map((adj) => {
        const ch = currentAdjChallenges.find((c) => c.id === adj.challenge_id) || { seed_number: "?" };
        let ruleDesc = "";
        if (adj.rule_type === "threshold_to_max") {
          ruleDesc = `คะแนน &ge; <strong>${adj.min_score.toLocaleString()}</strong> &rarr; ปรับเป็น <strong style="color: #16a34a;">${adj.target_score.toLocaleString()}</strong>`;
        } else if (adj.rule_type === "void_round") {
          ruleDesc = `ให้ทุกคนเต็ม <strong style="color: #16a34a;">${adj.target_score.toLocaleString()}</strong> (Void Round)`;
        } else if (adj.rule_type === "bonus_points") {
          ruleDesc = `บวกแต้มชดเชย <strong style="color: #0284c7;">+${adj.bonus_points.toLocaleString()}</strong>`;
        }

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="text-align: center; font-weight: bold; color: #00247d;">Map ${ch.seed_number}</td>
            <td style="text-align: center; font-weight: 600;">Round ${adj.round_number}</td>
            <td style="text-align: left; padding-left: 10px;">${ruleDesc}</td>
            <td style="text-align: left; padding-left: 10px; color: #64748b; font-size: 0.8rem;">${escapeHtml(adj.note || "-")}</td>
            <td style="text-align: center;">
              <button class="btn btn-danger" style="padding: 3px 8px; font-size: 0.75rem;" onclick="deleteAdjustment(${adj.id})">🗑️ ลบกฎ</button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

const createAdjustmentForm = document.getElementById("createAdjustmentForm");
if (createAdjustmentForm) {
  createAdjustmentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!adminDb) return;

    const challenge_id = Number(document.getElementById("adjMapSelect").value);
    const round_number = Number(document.getElementById("adjRoundSelect").value);
    const rule_type = document.getElementById("adjRuleType").value;
    const min_score = Number(document.getElementById("adjMinScore").value) || 4990;
    const target_score = Number(document.getElementById("adjTargetScore").value) || 5000;
    const bonus_points = Number(document.getElementById("adjBonusPoints").value) || 0;
    const note = document.getElementById("adjNote").value.trim();

    try {
      // 1. บันทึกลงตาราง score_adjustments
      const { error: adjErr } = await adminDb.from("score_adjustments").upsert(
        {
          challenge_id,
          round_number,
          rule_type,
          min_score,
          target_score,
          bonus_points,
          note,
          created_at: new Date().toISOString(),
        },
        { onConflict: "challenge_id,round_number" }
      );

      if (adjErr) throw adjErr;

      // 2. ปรับคะแนนย้อนหลังให้ผู้เล่นเดิมใน scores ทันที
      const { data: scores, error: scErr } = await adminDb
        .from("scores")
        .select("*")
        .eq("challenge_id", challenge_id);

      if (scErr) throw scErr;

      const rKey = `r${round_number}`;
      let updatedCount = 0;
      const scoreUpdates = [];

      (scores || []).forEach((s) => {
        let changed = false;
        let newRoundScore = s[rKey];

        if (rule_type === "threshold_to_max" && s[rKey] >= min_score) {
          newRoundScore = target_score;
          changed = true;
        } else if (rule_type === "void_round") {
          newRoundScore = target_score || 5000;
          changed = true;
        } else if (rule_type === "bonus_points" && bonus_points > 0) {
          newRoundScore = Math.min(5000, s[rKey] + bonus_points);
          changed = true;
        }

        if (changed) {
          updatedCount++;
          const r1 = round_number === 1 ? newRoundScore : s.r1;
          const r2 = round_number === 2 ? newRoundScore : s.r2;
          const r3 = round_number === 3 ? newRoundScore : s.r3;
          const r4 = round_number === 4 ? newRoundScore : s.r4;
          const r5 = round_number === 5 ? newRoundScore : s.r5;
          const total = r1 + r2 + r3 + r4 + r5;

          scoreUpdates.push({
            challenge_id: s.challenge_id,
            player_id: s.player_id,
            r1,
            r2,
            r3,
            r4,
            r5,
            total_score: total,
            updated_at: new Date().toISOString(),
          });
        }
      });

      if (scoreUpdates.length > 0) {
        const { error: upsertErr } = await adminDb
          .from("scores")
          .upsert(scoreUpdates, { onConflict: "challenge_id,player_id" });
        if (upsertErr) throw upsertErr;
      }

      alert(
        `✅ บันทึกกฎสำเร็จ!\n\nและได้ปรับคะแนนย้อนหลังให้ผู้เล่นปัจจุบันแล้ว ${updatedCount} คน\n(ผู้เล่นที่จะเล่นหลังจากนี้จะถูกปรับให้อัตโนมัติเมื่อ Sync)`
      );

      await loadActiveAdjustments(currentAdjWeekId);
    } catch (err) {
      console.error("Save adjustment error:", err);
      alert("เกิดข้อผิดพลาด: " + err.message);
    }
  });
}

window.deleteAdjustment = async function (adjId) {
  if (!adminDb) return;
  if (!confirm("คุณต้องการลบกฎข้อนี้ใช่หรือไม่?")) return;
  try {
    const { error } = await adminDb.from("score_adjustments").delete().eq("id", adjId);
    if (error) throw error;
    await loadActiveAdjustments(currentAdjWeekId);
  } catch (err) {
    alert("เกิดข้อผิดพลาดในการลบกฎ: " + err.message);
  }
};

// ==========================================
// 10. ระบบผู้เล่นทั้งหมด & สถิติ (Player Directory & Admin Inspector)
// ==========================================
let allDirectoryPlayers = [];

window.openPlayerDirectoryModal = async function () {
  const modal = document.getElementById("playerDirectoryModal");
  document.getElementById("playerDirSearchInput").value = "";
  modal.classList.add("open");
  await loadPlayerDirectory();
};

window.closePlayerDirectoryModal = function () {
  document.getElementById("playerDirectoryModal")?.classList.remove("open");
};

async function loadPlayerDirectory() {
  if (!adminDb) return;
  const tbody = document.getElementById("playerDirTableBody");
  tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: #64748b;">⏳ กำลังโหลดรายชื่อผู้เล่น...</td></tr>`;

  try {
    const { data: players, error: pErr } = await adminDb
      .from("players")
      .select("*")
      .order("username", { ascending: true });

    if (pErr) throw pErr;
    allDirectoryPlayers = players || [];
    document.getElementById("playerDirTotalCount").textContent = allDirectoryPlayers.length;

    const { data: scores, error: scErr } = await adminDb
      .from("scores")
      .select("player_id, r1, r2, r3, r4, r5, total_score");

    if (scErr) throw scErr;

    const statsMap = new Map();
    (scores || []).forEach((s) => {
      if (!statsMap.has(s.player_id)) {
        statsMap.set(s.player_id, { maps: 0, count5k: 0, count25k: 0 });
      }
      const st = statsMap.get(s.player_id);
      st.maps++;
      [s.r1, s.r2, s.r3, s.r4, s.r5].forEach((r) => {
        if (r === 5000) st.count5k++;
      });
      if (s.total_score === 25000) st.count25k++;
    });

    allDirectoryPlayers.forEach((p) => {
      p.stats = statsMap.get(p.id) || { maps: 0, count5k: 0, count25k: 0 };
    });

    renderPlayerDirectoryList();
  } catch (err) {
    console.error("Load player directory error:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

window.renderPlayerDirectoryList = function () {
  const filter = (document.getElementById("playerDirSearchInput").value || "").trim().toLowerCase();
  const tbody = document.getElementById("playerDirTableBody");

  const filtered = allDirectoryPlayers.filter((p) => {
    if (!filter) return true;
    return (p.username || "").toLowerCase().includes(filter) || (p.id || "").toLowerCase().includes(filter);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 24px; text-align: center; color: #94a3b8;">ไม่พบผู้เล่นที่ค้นหา</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((p, idx) => {
      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="text-align: center; color: #64748b;">${idx + 1}</td>
          <td style="text-align: left; padding: 8px 12px; font-weight: bold; color: #00247d;">${escapeHtml(p.username)}</td>
          <td style="text-align: center; font-family: monospace; font-size: 0.78rem; color: #64748b;">${escapeHtml(p.id)}</td>
          <td style="text-align: center;">${p.stats.maps} แมพ</td>
          <td style="text-align: center; font-weight: bold; color: #16a34a;">${p.stats.count5k}</td>
          <td style="text-align: center; font-weight: bold; color: #b45309;">${p.stats.count25k}</td>
          <td style="text-align: center;">
            <button class="btn" style="background: #0284c7; padding: 4px 8px; font-size: 0.75rem;" onclick="openAdminPlayerProfile('${p.id}')">
              🔍 ดูประวัติทั้งหมด
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
};

window.openAdminPlayerProfile = async function (playerId) {
  if (!adminDb) return;
  const modal = document.getElementById("adminPlayerModal");
  const usernameEl = document.getElementById("admProfUsername");
  const idSub = document.getElementById("admProfIdSub");
  const geoguessrLink = document.getElementById("admProfGeoguessrLink");
  const weeksPlayedEl = document.getElementById("admProfWeeksPlayed");
  const totalMapsEl = document.getElementById("admProfTotalMaps");
  const count5kEl = document.getElementById("admProf5kRounds");
  const count25kEl = document.getElementById("admProf25kGames");
  const tbody = document.getElementById("admProfHistoryTableBody");

  usernameEl.textContent = "Loading Profile...";
  idSub.textContent = `User ID: ${playerId}`;
  geoguessrLink.href = `https://www.geoguessr.com/user/${playerId}`;
  tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center; color: #64748b;">กำลังโหลดประวัติทุกสัปดาห์...</td></tr>`;

  modal.classList.add("open");

  try {
    const { data: scores, error: scErr } = await adminDb
      .from("scores")
      .select("*, challenges(*, weeks(*)), players(username)")
      .eq("player_id", playerId);

    if (scErr) throw scErr;

    const allScores = scores || [];
    const username = allScores[0]?.players?.username || "Player";
    usernameEl.textContent = username;

    let count5k = 0;
    let count25k = 0;
    const uniqueWeeks = new Set();

    allScores.forEach((s) => {
      [s.r1, s.r2, s.r3, s.r4, s.r5].forEach((r) => {
        if (r === 5000) count5k++;
      });
      if (s.total_score === 25000) count25k++;
      if (s.challenges?.week_id) uniqueWeeks.add(s.challenges.week_id);
    });

    weeksPlayedEl.textContent = uniqueWeeks.size;
    totalMapsEl.textContent = allScores.length;
    count5kEl.textContent = count5k.toLocaleString();
    count25kEl.textContent = count25k.toLocaleString();

    if (allScores.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center;">ยังไม่มีประวัติการเล่นในระบบ</td></tr>`;
      return;
    }

    allScores.sort((a, b) => {
      const wA = a.challenges?.week_id || 0;
      const wB = b.challenges?.week_id || 0;
      if (wB !== wA) return wB - wA;
      return (a.challenges?.seed_number || 0) - (b.challenges?.seed_number || 0);
    });

    tbody.innerHTML = allScores
      .map((s) => {
        const ch = s.challenges || {};
        const wk = ch.weeks || {};
        const modeInfo = detectMapMode(ch.name);
        const total = s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));
        const statusTag = wk.is_frozen
          ? `<span style="font-size: 0.7rem; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px;">Frozen</span>`
          : `<span style="font-size: 0.7rem; background: #fef3c7; color: #b45309; padding: 1px 4px; border-radius: 3px;">Live</span>`;

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="font-weight: 600; color: #475569;">
              ${escapeHtml(wk.title || `W${ch.week_id}`)} ${statusTag}
            </td>
            <td style="text-align: left; padding-left: 10px;">
              <strong>M${ch.seed_number}:</strong> ${renderFlags(escapeHtml(ch.name || `Seed ${ch.seed_number}`))}
            </td>
            <td><span class="mode-tag ${modeInfo.cls}">${modeInfo.label}</span></td>
            <td>${(s.r1 ?? 0).toLocaleString()}</td>
            <td>${(s.r2 ?? 0).toLocaleString()}</td>
            <td>${(s.r3 ?? 0).toLocaleString()}</td>
            <td>${(s.r4 ?? 0).toLocaleString()}</td>
            <td>${(s.r5 ?? 0).toLocaleString()}</td>
            <td style="background: #eff6ff; font-weight: bold; color: #1e3a8a;">${total.toLocaleString()}</td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Admin open profile error:", err);
    tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
};

window.closeAdminPlayerModal = function () {
  document.getElementById("adminPlayerModal")?.classList.remove("open");
};

function detectMapMode(name) {
  if (!name) return { label: "Standard", cls: "other" };
  if (/nmpz/i.test(name)) return { label: "NMPZ", cls: "nmpz" };
  if (/\bnm\b|no\s*move/i.test(name)) return { label: "NM", cls: "nm" };
  if (/move/i.test(name)) return { label: "Move", cls: "move" };
  return { label: "Standard", cls: "other" };
}

// ปิด Modal เมื่อคลิกพื้นที่ด้านนอก (Backdrop Click) หรือกด Esc
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

// ==========================================
// 8. ตรวจสอบการคิดคะแนนแต่ละเกม (Map & Round Calculation Inspector)
// ==========================================
let inspWeekId = null;
let inspWeekChallenges = [];
let inspWeekScores = [];
let inspCalculatedMaps = new Map();
let inspSelectedSeed = 1;
let inspCurrentSubView = "map"; // "map" | "round"
let inspSelectedRound = 0; // 0..4 = R1..R5, 5 = Total 25k (R6)

function getRankClass(rank) {
  if (rank === 1) return "rank-gold";
  if (rank === 2) return "rank-silver";
  if (rank === 3) return "rank-bronze";
  return "";
}

window.openMapInspectorModal = async function (weekId, weekTitle) {
  if (!adminDb) return;
  inspWeekId = weekId;
  const modal = document.getElementById("mapInspectorModal");
  document.getElementById("inspectorModalSubtitle").textContent = `สัปดาห์: ${weekTitle || `Week ${weekId}`}`;
  document.getElementById("inspectorTableBody").innerHTML = `<tr><td colspan="10" style="padding: 30px; text-align: center; color: #64748b;">กำลังโหลดและคำนวณคะแนนของสัปดาห์นี้...</td></tr>`;

  modal.classList.add("open");
  await loadAndComputeInspectorData(weekId);
};

window.openInspectorFromScoresModal = function () {
  if (!currentScoresWeekId) return;
  const subtitle = document.getElementById("scoresModalSubtitle").textContent.replace("สัปดาห์: ", "").trim();
  openMapInspectorModal(currentScoresWeekId, subtitle);
};

window.closeMapInspectorModal = function () {
  document.getElementById("mapInspectorModal")?.classList.remove("open");
};

async function loadAndComputeInspectorData(weekId) {
  try {
    const { data: challenges, error: chErr } = await adminDb
      .from("challenges")
      .select("*")
      .eq("week_id", weekId)
      .order("seed_number", { ascending: true });

    if (chErr) throw chErr;
    inspWeekChallenges = challenges || [];

    const chIds = inspWeekChallenges.map((c) => c.id);
    const { data: scores, error: scErr } = await adminDb
      .from("scores")
      .select("*, players(id, username)")
      .in("challenge_id", chIds);

    if (scErr) throw scErr;
    inspWeekScores = scores || [];

    computeInspectorCalculations();
    inspSelectedSeed = inspWeekChallenges[0]?.seed_number || 1;
    inspCurrentSubView = "map";
    inspSelectedRound = 0;

    renderMapInspector();
  } catch (err) {
    console.error("Load inspector data error:", err);
    document.getElementById("inspectorTableBody").innerHTML = `<tr><td colspan="10" style="padding: 24px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function computeInspectorCalculations() {
  inspCalculatedMaps.clear();

  inspWeekChallenges.forEach((c) => {
    const rawScores = inspWeekScores.filter((s) => s.challenge_id === c.id);
    const pList = rawScores.map((s) => ({
      scoreId: s.id,
      playerId: s.player_id,
      username: s.players?.username || `Player #${s.player_id}`,
      raw: [
        s.r1 || 0,
        s.r2 || 0,
        s.r3 || 0,
        s.r4 || 0,
        s.r5 || 0,
        s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0))
      ],
      phantoms: [],
      points: [],
      h2h: []
    }));

    if (pList.length > 0) {
      for (let m = 0; m < 6; m++) {
        const maxScore = m < 5 ? 5000 : 25000;

        pList.forEach((p) => {
          const raw = p.raw[m];
          const missing = Math.max(0, maxScore - raw);
          const phantom = raw + 0.1 * missing;
          p.phantoms[m] = phantom;
        });

        // Pairwise Head-to-Head Half-Tie
        pList.forEach((p, i) => {
          let pts = 0;
          let wins = 0;
          let ties = 0;
          let losses = 0;
          const pRaw = p.raw[m];
          const pPhan = p.phantoms[m];

          pList.forEach((opp, j) => {
            if (i === j) return;
            const oppRaw = opp.raw[m];
            const oppPhan = opp.phantoms[m];

            if (pRaw > oppPhan && oppRaw <= pPhan) {
              pts += 1;
              wins += 1;
            } else if (pRaw <= oppPhan && oppRaw <= pPhan) {
              pts += 0.5;
              ties += 1;
            } else {
              losses += 1;
            }
          });

          p.points[m] = pts;
          p.h2h[m] = { wins, ties, losses };
        });
      }

      // Map Points = sum of 6 rounds, rounded with Math.round
      pList.forEach((p) => {
        p.ptsRounds = p.points.reduce((a, b) => a + b, 0);
        p.ptsMap = Math.round(p.ptsRounds);
      });

      // Sort by ptsMap desc, tiebreaker raw total
      pList.sort((a, b) => b.ptsMap - a.ptsMap || b.raw[5] - a.raw[5]);

      pList.forEach((p, idx) => {
        const isTie = idx > 0 && pList[idx - 1].ptsMap === p.ptsMap;
        p.mapRank = isTie ? pList[idx - 1].mapRank : idx + 1;
      });
    }

    inspCalculatedMaps.set(c.id, pList);
  });
}

window.selectInspectorMap = function (seedNum) {
  inspSelectedSeed = seedNum;
  renderMapInspector();
};

window.setInspectorSubView = function (subView) {
  inspCurrentSubView = subView;
  renderMapInspector();
};

window.selectInspectorRound = function (rndIdx) {
  inspSelectedRound = rndIdx;
  renderMapInspector();
};

function renderMapInspector() {
  const pillsContainer = document.getElementById("inspectorMapPills");
  pillsContainer.innerHTML = inspWeekChallenges
    .map((c) => {
      const isSel = c.seed_number === inspSelectedSeed;
      const bgStyle = isSel
        ? "background: #0284c7; color: white; border-color: #0284c7;"
        : "background: white; color: #475569; border: 1px solid #cbd5e1;";
      return `
        <button class="btn" style="${bgStyle} font-size: 0.8rem; padding: 5px 12px; border-radius: 20px;" onclick="selectInspectorMap(${c.seed_number})">
          🗺️ Map ${c.seed_number}: ${renderFlags(escapeHtml(c.name || `Seed ${c.seed_number}`))}
        </button>
      `;
    })
    .join("");

  const activeChallenge = inspWeekChallenges.find((c) => c.seed_number === inspSelectedSeed) || inspWeekChallenges[0];
  if (!activeChallenge) return;

  const pList = inspCalculatedMaps.get(activeChallenge.id) || [];
  const thead = document.getElementById("inspectorTableHead");
  const tbody = document.getElementById("inspectorTableBody");

  const btnMap = document.getElementById("inspBtnMapSummary");
  const btnRound = document.getElementById("inspBtnRoundDeep");
  const roundPillsContainer = document.getElementById("inspectorRoundPillsContainer");

  if (inspCurrentSubView === "map") {
    btnMap.style.background = "var(--navy-primary)";
    btnMap.style.color = "white";
    btnRound.style.background = "#e2e8f0";
    btnRound.style.color = "#334155";
    roundPillsContainer.style.display = "none";

    thead.innerHTML = `
      <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
        <th style="width: 55px; text-align: center; padding: 8px;">อันดับ</th>
        <th style="text-align: left; padding: 8px 12px; width: 170px;">ผู้เล่น (Pseudo)</th>
        <th style="width: 75px; text-align: center;">R1</th>
        <th style="width: 75px; text-align: center;">R2</th>
        <th style="width: 75px; text-align: center;">R3</th>
        <th style="width: 75px; text-align: center;">R4</th>
        <th style="width: 75px; text-align: center;">R5</th>
        <th style="width: 95px; text-align: center; background: #eff6ff; color: #1e3a8a;">Total 25k</th>
        <th style="width: 90px; text-align: center; background: #00247d; color: white;">Map Points</th>
      </tr>
    `;

    if (pList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="padding: 30px; text-align: center; color: #94a3b8;">ยังไม่มีผู้เล่นในแมพนี้</td></tr>`;
      return;
    }

    tbody.innerHTML = pList
      .map((p) => {
        const rankCls = getRankClass(p.mapRank);
        const roundCells = [0, 1, 2, 3, 4]
          .map(
            (rIdx) => `
            <td style="text-align: center; padding: 6px 4px; border-bottom: 1px solid #e2e8f0;">
              <div style="font-weight: 600; color: #334155;">${p.raw[rIdx].toLocaleString()}</div>
              <div style="font-size: 0.73rem; color: #16a34a; font-weight: 700;">+${p.points[rIdx]} pts</div>
            </td>
          `
          )
          .join("");

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td class="col-pos ${rankCls}" style="text-align: center;">${p.mapRank}</td>
            <td style="padding: 6px 12px; font-weight: 600; color: #1e293b;">${escapeHtml(p.username)}</td>
            ${roundCells}
            <td style="text-align: center; padding: 6px 4px; background: #eff6ff;">
              <div style="font-weight: 700; color: #1e3a8a;">${p.raw[5].toLocaleString()}</div>
              <div style="font-size: 0.73rem; color: #1e3a8a; font-weight: 700;">+${p.points[5]} pts</div>
            </td>
            <td style="text-align: center; font-size: 1.05rem; font-weight: 800; color: #00247d; background: #f8fafc;">
              ${p.ptsMap}
            </td>
          </tr>
        `;
      })
      .join("");
  } else {
    // Round Deep Dive View
    btnMap.style.background = "#e2e8f0";
    btnMap.style.color = "#334155";
    btnRound.style.background = "var(--navy-primary)";
    btnRound.style.color = "white";
    roundPillsContainer.style.display = "flex";

    document.querySelectorAll(".insp-rnd-btn").forEach((btn) => {
      const rnd = parseInt(btn.getAttribute("data-rnd"), 10);
      if (rnd === inspSelectedRound) {
        btn.style.background = "#0284c7";
        btn.style.color = "white";
      } else {
        btn.style.background = "#e2e8f0";
        btn.style.color = "#475569";
      }
    });

    const m = inspSelectedRound;
    const roundTitle = m < 5 ? `Round ${m + 1} (เต็ม 5,000 คะแนน)` : `Total Score (เต็ม 25,000 คะแนน)`;

    thead.innerHTML = `
      <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
        <th style="width: 55px; text-align: center; padding: 8px;">อันดับ</th>
        <th style="text-align: left; padding: 8px 12px; width: 170px;">ผู้เล่น (Pseudo)</th>
        <th style="width: 100px; text-align: center;">คะแนนดิบ (Raw)</th>
        <th style="width: 110px; text-align: center; background: #eff6ff; color: #1e3a8a;">Phantom (10%)</th>
        <th style="text-align: left; padding: 8px 12px;">ผลการเจอกับคู่แข่งอีก ${pList.length - 1} คน (H2H)</th>
        <th style="width: 100px; text-align: center; background: #00247d; color: white;">แต้มรอบนี้</th>
      </tr>
    `;

    if (pList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 30px; text-align: center; color: #94a3b8;">ยังไม่มีผู้เล่นในแมพนี้</td></tr>`;
      return;
    }

    const roundPlayers = [...pList].sort((a, b) => b.points[m] - a.points[m] || b.raw[m] - a.raw[m]);
    roundPlayers.forEach((p, idx) => {
      const isTie = idx > 0 && roundPlayers[idx - 1].points[m] === p.points[m];
      p.roundRank = isTie ? roundPlayers[idx - 1].roundRank : idx + 1;
    });

    tbody.innerHTML = roundPlayers
      .map((p) => {
        const rankCls = getRankClass(p.roundRank);
        const h = p.h2h[m] || { wins: 0, ties: 0, losses: 0 };
        const phantomVal = p.phantoms[m] !== undefined ? p.phantoms[m].toFixed(1) : "-";

        let outcomeBadge = `
          <span style="display: inline-block; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">
            ชนะ ${h.wins}
          </span>
        `;
        if (h.ties > 0) {
          outcomeBadge += `
            <span style="display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.75rem; margin-left: 4px;">
              เสมอ ${h.ties}
            </span>
          `;
        }
        outcomeBadge += `
          <span style="display: inline-block; background: #f1f5f9; color: #64748b; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; margin-left: 4px;">
            แพ้ ${h.losses}
          </span>
        `;

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td class="col-pos ${rankCls}" style="text-align: center;">${p.roundRank}</td>
            <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${escapeHtml(p.username)}</td>
            <td style="text-align: center; font-weight: 700; color: #0f172a;">${p.raw[m].toLocaleString()}</td>
            <td style="text-align: center; font-weight: 700; color: #1e3a8a; background: #f0f7ff;">${phantomVal}</td>
            <td style="padding: 8px 12px;">${outcomeBadge}</td>
            <td style="text-align: center; font-weight: 800; font-size: 1rem; color: #15803d; background: #f8fafc;">
              +${p.points[m]} pts
            </td>
          </tr>
        `;
      })
      .join("");
  }
}


checkAuth();
