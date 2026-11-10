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

    alert("✅ บันทึกการแก้ไขสัปดาห์และ 7 Maps เรียบร้อยแล้ว!");
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

checkAuth();
