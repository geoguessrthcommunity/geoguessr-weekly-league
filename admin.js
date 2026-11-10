// ====================================================================
// GeoGuessr Weekly Challenge - Admin Script with Secure Login Gate
// ====================================================================

const loginGate = document.getElementById("loginGate");
const adminDashboard = document.getElementById("adminDashboard");
const loginForm = document.getElementById("loginForm");
const loginKeyInput = document.getElementById("loginKeyInput");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const createWeekForm = document.getElementById("createWeekForm");
const weeksList = document.getElementById("weeksList");

let adminDb = null;

// ตรวจสอบสถานะล็อกอินทันทีที่เปิดหน้า
async function checkAuth() {
  const savedKey = localStorage.getItem("llgg_admin_service_key") || "";
  if (!savedKey) {
    showLogin();
    return;
  }

  const isValid = await verifyKey(savedKey);
  if (isValid) {
    showDashboard();
  } else {
    localStorage.removeItem("llgg_admin_service_key");
    showLogin();
  }
}

async function verifyKey(key) {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
    showLoginError("❌ กรุณาตั้งค่า CONFIG.SUPABASE_URL ใน config.js ก่อนใช้งาน");
    return false;
  }

  try {
    const testDb = supabase.createClient(CONFIG.SUPABASE_URL, key);
    // ทดสอบยิง Query สิทธิ์ Service Role
    const { error } = await testDb.from("weeks").select("id").limit(1);
    if (error) {
      console.warn("Auth check error:", error.message);
      return false;
    }
    adminDb = testDb;
    return true;
  } catch (err) {
    return false;
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

  const isValid = await verifyKey(key);
  if (isValid) {
    localStorage.setItem("llgg_admin_service_key", key);
    loginKeyInput.value = "";
    showDashboard();
  } else {
    showLoginError("❌ Key ไม่ถูกต้อง หรือไม่มีสิทธิ์เข้าถึงฐานข้อมูล Supabase");
  }
});

// ออกจากระบบ
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
 * โหลดและแสดงรายการสัปดาห์ทั้งหมด
 */
async function loadWeeks() {
  if (!adminDb) return;
  weeksList.innerHTML = `<p style="color: #64748b;">กำลังโหลด...</p>`;

  const { data: weeks, error } = await adminDb
    .from("weeks")
    .select("*")
    .order("id", { ascending: false });

  if (error || !weeks || weeks.length === 0) {
    weeksList.innerHTML = `<p style="color: #64748b;">ยังไม่มีสัปดาห์ใด ๆ ในระบบ</p>`;
    return;
  }

  weeksList.innerHTML = weeks
    .map((w) => {
      const activeTag = w.is_active ? `<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">สัปดาห์ปัจจุบัน (Active)</span>` : "";
      const frozenTag = w.is_frozen
        ? `<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">❄️ Freeze แล้ว</span>`
        : `<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">กำลังแข่ง</span>`;

      return `
        <div class="week-item">
          <div>
            <strong style="font-size: 1.05rem;">${escapeHtml(w.title)}</strong>
            <div style="font-size: 0.82rem; color: #64748b; margin-top: 2px;">${escapeHtml(w.header_info || "")}</div>
            <div style="margin-top: 6px; display: flex; gap: 8px;">
              ${frozenTag}
              ${activeTag}
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            ${
              !w.is_active
                ? `<button class="btn" style="background: #475569;" onclick="setActiveWeek(${w.id})">ตั้งเป็นหน้าแรก</button>`
                : ""
            }
            ${
              !w.is_frozen
                ? `<button class="btn btn-freeze" onclick="freezeWeek(${w.id})">❄️ Freeze ทันที</button>`
                : ""
            }
            <button class="btn btn-danger" onclick="deleteWeek(${w.id}, '${escapeHtml(w.title)}')">ลบ</button>
          </div>
        </div>
      `;
    })
    .join("");
}

/**
 * สร้างสัปดาห์ใหม่พร้อม 7 Maps
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

window.freezeWeek = async function (id) {
  if (!adminDb) return;
  if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการ Freeze สัปดาห์นี้? (คะแนนดิบจะถูกปลดล็อกให้ทุกคนดูได้)")) return;
  await adminDb.from("weeks").update({ is_frozen: true }).eq("id", id);
  loadWeeks();
};

window.deleteWeek = async function (id, title) {
  if (!adminDb) return;
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบสัปดาห์ "${title}"? ข้อมูลคะแนนทั้งหมดจะหายไป`)) return;
  await adminDb.from("weeks").delete().eq("id", id);
  loadWeeks();
};

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

checkAuth();
