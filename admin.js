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
const weeksById = new Map();

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

function getDefaultMapPlaceholders(mapNum) {
  const placeholders = [
    "ชื่อแมพ & โหมด (เช่น Europe | Move 3')",
    "ชื่อแมพ & โหมด (เช่น Asia | No move 2')",
    "ชื่อแมพ & โหมด (เช่น Americas | NM 2')",
    "ชื่อแมพ & โหมด (เช่น Africa | Move 3')",
    "ชื่อแมพ & โหมด (เช่น World | Move 3')",
    "ชื่อแมพ & โหมด (เช่น Urban World | NMPZ 1')",
    "ชื่อแมพ & โหมด (เช่น Country Count | 5 Seeds)",
  ];
  return placeholders[mapNum - 1] || `ชื่อแมพ Map ${mapNum}`;
}

function renderSeedRowsHtml(prefix, mapNum, seedCount, urls = []) {
  return Array.from({ length: seedCount }, (_, idx) => {
    const sNum = idx + 1;
    const val = urls[idx] || "";
    const label = seedCount > 1 ? `Seed ${sNum}:` : `ลิงก์:`;
    return `
      <div class="map-seed-row">
        <span class="map-seed-label">${label}</span>
        <input type="text" class="${prefix}-map-url" data-map="${mapNum}" data-subseed="${sNum}"
          placeholder="ลิงก์ Challenge Seed ${sNum} (เว้นว่างไว้ก่อนได้)" value="${escapeHtml(val)}">
      </div>
    `;
  }).join("");
}

function renderMapBuilder(container, prefix, mapsConfig = []) {
  if (!container) return;
  container.innerHTML = [1, 2, 3, 4, 5, 6, 7]
    .map((mapNum) => {
      const cfg = mapsConfig.find((m) => m.mapNumber === mapNum) || {};
      const name = cfg.name || "";
      const gameType = cfg.gameType || "standard";
      const urls = Array.isArray(cfg.urls) ? cfg.urls : [];
      const seedCount = Math.max(1, Math.min(10, Number(cfg.seedCount || urls.length || 1)));

      return `
        <div class="map-builder-card" data-map-card="${mapNum}">
          <div class="map-builder-header">
            <strong>Map ${mapNum}:</strong>
            <input type="text" class="${prefix}-map-name" data-map="${mapNum}"
              placeholder="${escapeHtml(getDefaultMapPlaceholders(mapNum))}" value="${escapeHtml(name)}">
            <select class="${prefix}-map-type" data-map="${mapNum}" title="ประเภทเกมและการคิดคะแนน">
              <option value="standard" ${gameType === "standard" ? "selected" : ""}>📊 Standard (Raw + Phantom 10%)</option>
              <option value="country_count" ${gameType === "country_count" ? "selected" : ""}>🌍 Country Count (No Phantom)</option>
            </select>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" class="${prefix}-map-seedcount" data-map="${mapNum}" min="1" max="10" value="${seedCount}"
                title="จำนวน Seeds ใน Map นี้ (1-10)" onchange="updateMapBuilderSeedRows('${prefix}', ${mapNum}, this.value)">
              <span style="font-size: 0.75rem; color: #64748b; white-space: nowrap;">seeds</span>
            </div>
          </div>
          <div class="map-seeds-list" id="${prefix}-seeds-list-${mapNum}">
            ${renderSeedRowsHtml(prefix, mapNum, seedCount, urls)}
          </div>
        </div>
      `;
    })
    .join("");
}

window.updateMapBuilderSeedRows = function (prefix, mapNum, rawCount) {
  const count = Math.max(1, Math.min(10, parseInt(rawCount, 10) || 1));
  const listEl = document.getElementById(`${prefix}-seeds-list-${mapNum}`);
  if (!listEl) return;

  // เก็บค่า URL ที่พิมพ์ค้างไว้ก่อน re-render
  const currentUrls = Array.from(listEl.querySelectorAll(`.${prefix}-map-url`)).map((inp) => inp.value);
  const countInput = listEl.closest(".map-builder-card")?.querySelector(`.${prefix}-map-seedcount`);
  if (countInput) countInput.value = count;

  listEl.innerHTML = renderSeedRowsHtml(prefix, mapNum, count, currentUrls);
};

function collectMapBuilderData(container, prefix) {
  const items = [];
  let usesAdvanced = false;

  for (let mapNum = 1; mapNum <= 7; mapNum++) {
    const card = container.querySelector(`[data-map-card="${mapNum}"]`);
    const name = (card?.querySelector(`.${prefix}-map-name`)?.value || "").trim();
    const gameType = card?.querySelector(`.${prefix}-map-type`)?.value || "standard";
    const urlInputs = Array.from(card?.querySelectorAll(`.${prefix}-map-url`) || []);
    const seedCount = Math.max(1, urlInputs.length);

    if (seedCount > 1 || gameType !== "standard") {
      usesAdvanced = true;
    }

    for (let sIdx = 0; sIdx < seedCount; sIdx++) {
      const subSeedNum = sIdx + 1;
      const rawUrl = (urlInputs[sIdx]?.value || "").trim();
      let token = "";

      if (rawUrl) {
        token = extractToken(rawUrl);
        if (!token) {
          alert(`ลิงก์สำหรับ Map ${mapNum} (Seed ${subSeedNum}) ไม่ถูกต้อง (หากยังไม่มีลิงก์ ให้เว้นว่างไว้ก่อนได้)`);
          return null;
        }
      }

      items.push({
        seed_number: mapNum,
        map_number: mapNum,
        sub_seed_number: subSeedNum,
        game_type: gameType,
        name: name || (token ? `Map ${mapNum}` : `Map ${mapNum} (TBD)`),
        token: token || "",
        url: token ? (rawUrl.startsWith("http") ? rawUrl : `https://www.geoguessr.com/challenge/${token}`) : "",
      });
    }
  }

  return { items, usesAdvanced };
}

function buildMapsConfigFromChallenges(challenges) {
  const sorted = sortChallenges(challenges);
  const mapGroups = new Map();

  sorted.forEach((c) => {
    const m = getMapNum(c);
    if (!mapGroups.has(m)) {
      mapGroups.set(m, {
        mapNumber: m,
        name: c.name || "",
        gameType: getGameType(c),
        urls: [],
      });
    }
    const g = mapGroups.get(m);
    const urlVal = c.url || (c.token ? `https://www.geoguessr.com/challenge/${c.token}` : "");
    g.urls.push(urlVal);
  });

  return Array.from(mapGroups.values()).map((g) => ({
    ...g,
    seedCount: Math.max(1, g.urls.length),
  }));
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
    weeksById.clear();
    weeksList.innerHTML = `<p style="color: #64748b; padding: 12px;">ยังไม่มีสัปดาห์ใด ๆ ในระบบ</p>`;
    return;
  }

  weeksById.clear();
  weeks.forEach((w) => weeksById.set(w.id, w));

  weeksList.innerHTML = weeks
    .map((w) => {
      let statusTag = "";
      if (w.is_frozen) {
        statusTag = `<span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">❄️ Freeze แล้ว</span>`;
      } else if (w.is_active) {
        statusTag = `<span style="background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold;">🟢 กำลังแข่ง (Active)</span>`;
      } else {
        statusTag = `<span style="background: #f1f5f9; color: #475569; padding: 3px 8px; border-radius: 10px; font-size: 0.8rem; font-weight: bold; border: 1px solid #cbd5e1;">🗓️ แบบร่าง / ล่วงหน้า (Draft)</span>`;
      }

      let dateInfoHtml = "";
      if (w.start_date) {
        const sd = new Date(w.start_date);
        dateInfoHtml += `<div style="font-size: 0.8rem; color: #64748b;">วันเริ่ม: <strong>${sd.toLocaleDateString("th-TH")} ${sd.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</strong></div>`;
      }
      if (w.end_date) {
        const ed = new Date(w.end_date);
        dateInfoHtml += `<div style="font-size: 0.8rem; color: #64748b;">วันตัดรอบ: <strong>${ed.toLocaleDateString("th-TH")} ${ed.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</strong></div>`;
      } else {
        dateInfoHtml += `<div style="font-size: 0.8rem; color: #64748b;">วันตัดรอบ: <strong>ไม่ได้กำหนด (แมนนวล)</strong></div>`;
      }

      const sortedCh = sortChallenges(w.challenges || []);
      const mapGroups = new Map();
      sortedCh.forEach((c) => {
        const m = getMapNum(c);
        if (!mapGroups.has(m)) mapGroups.set(m, []);
        mapGroups.get(m).push(c);
      });

      const challengesList = Array.from(mapGroups.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([mapNum, seeds]) => {
          const first = seeds[0];
          const totalSeeds = seeds.length;
          const linkedCount = seeds.filter((s) => s.token && s.token.trim() !== "").length;
          const hasAllLinks = linkedCount === totalSeeds;
          const isPartial = linkedCount > 0 && linkedCount < totalSeeds;
          const bg = hasAllLinks ? "#e2e8f0" : isPartial ? "#fef3c7" : "#fee2e2";
          const color = hasAllLinks ? "#1e293b" : isPartial ? "#92400e" : "#991b1b";
          const typeBadge = getGameType(first) === "country_count" ? " 🌍" : "";
          const seedBadge = totalSeeds > 1 ? ` • ${totalSeeds} Seeds` : "";
          const linkText = totalSeeds > 1 ? `🔗 ${linkedCount}/${totalSeeds}` : linkedCount > 0 ? "🔗" : "⚠️ ไม่มีลิงก์";
          return `<span style="background: ${bg}; color: ${color}; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">M${mapNum}${typeBadge}: ${renderFlags(escapeHtml(first.name || `Map ${mapNum}`))}${seedBadge} (${linkText})</span>`;
        })
        .join(" ");

      let actionButtons = "";
      if (w.is_frozen) {
        actionButtons += `<button class="btn btn-unfreeze" onclick="toggleFreeze(${w.id}, false)">🔓 ปลด Freeze (เปิดแข่งต่อ)</button>`;
      } else if (w.is_active) {
        actionButtons += `<button class="btn" style="background: #eab308; color: #0f172a;" onclick="setDraftWeek(${w.id})">⏸️ พักเป็นแบบร่าง</button>`;
        actionButtons += `<button class="btn btn-freeze" onclick="toggleFreeze(${w.id}, true)">❄️ Freeze ทันที</button>`;
      } else {
        actionButtons += `<button class="btn" style="background: #16a34a; color: white;" onclick="setActiveWeek(${w.id})">🚀 เปิดแข่งขันทันที (Set Active)</button>`;
      }

      return `
        <div class="week-card-item">
          <div class="week-header-row">
            <div>
              <strong style="font-size: 1.15rem; color: #0f172a;">${escapeHtml(w.title)}</strong>
              <div style="font-size: 0.85rem; color: #475569; margin: 4px 0;">${escapeHtml(w.header_info || "(ไม่มีข้อความหัวเว็บ)")}</div>
              ${dateInfoHtml}
              <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                ${statusTag}
              </div>
            </div>
            
            <div class="week-actions">
              ${actionButtons}
              <button class="btn" style="background: #0284c7; color: white;" onclick="openScoresModal(${w.id})">📊 จัดการคะแนน</button>
              <button class="btn" style="background: #0d9488; color: white;" onclick="openMapInspectorModal(${w.id})">🧮 ตรวจการคิดคะแนน</button>
              <button class="btn" style="background: #7c3aed; color: white;" onclick="openAdjustmentsModal(${w.id})">🛠️ กฎคะแนนพิเศษ</button>
              <button class="btn btn-edit" onclick="openEditModal(${w.id})">✏️ แก้ไขข้อมูล & 7 Maps</button>
              <button class="btn btn-danger" onclick="deleteWeek(${w.id})">🗑️ ลบ</button>
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

  // แปลง start_date เป็น format สำหรับ input datetime-local
  const editStartDateInput = document.getElementById("editWeekStartDate");
  if (editStartDateInput) {
    if (week.start_date) {
      const sd = new Date(week.start_date);
      sd.setMinutes(sd.getMinutes() - sd.getTimezoneOffset());
      editStartDateInput.value = sd.toISOString().slice(0, 16);
    } else {
      editStartDateInput.value = "";
    }
  }

  const mapsConfig = buildMapsConfigFromChallenges(week.challenges || []);
  renderMapBuilder(editMapsContainer, "edit", mapsConfig);

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
  const startDateInput = document.getElementById("editWeekStartDate");
  const startDateVal = startDateInput ? startDateInput.value : null;
  const startDate = startDateVal ? new Date(startDateVal).toISOString() : null;
  const endDateVal = editWeekEndDate.value;
  const endDate = endDateVal ? new Date(endDateVal).toISOString() : null;

  const collected = collectMapBuilderData(editMapsContainer, "edit");
  if (!collected) return;

  const challengesToUpsert = collected.items.map((item) => ({
    week_id: weekId,
    ...item,
  }));

  try {
    // 0. ตรวจสอบการเปลี่ยน Token หรือการลดจำนวน Seed ที่อาจมีคะแนนค้างอยู่
    const { data: existingChallenges, error: exErr } = await adminDb
      .from("challenges")
      .select("*")
      .eq("week_id", weekId);

    if (exErr) throw exErr;

    const mapsWithChangedToken = [];
    const removedChallenges = [];
    const newKeys = new Set(challengesToUpsert.map((c) => `${c.map_number}:${c.sub_seed_number}`));

    if (existingChallenges && existingChallenges.length > 0) {
      for (const oldCh of existingChallenges) {
        const oldMap = getMapNum(oldCh);
        const oldSub = getSubSeedNum(oldCh);
        const key = `${oldMap}:${oldSub}`;

        if (!newKeys.has(key)) {
          const { count } = await adminDb
            .from("scores")
            .select("*", { count: "exact", head: true })
            .eq("challenge_id", oldCh.id);
          removedChallenges.push({
            oldId: oldCh.id,
            map: oldMap,
            subSeed: oldSub,
            name: oldCh.name || `Map ${oldMap}`,
            count: count || 0,
          });
          continue;
        }

        const newCh = challengesToUpsert.find(
          (c) => c.map_number === oldMap && c.sub_seed_number === oldSub
        );
        if (newCh && oldCh.token !== newCh.token) {
          const { count, error: countErr } = await adminDb
            .from("scores")
            .select("*", { count: "exact", head: true })
            .eq("challenge_id", oldCh.id);

          if (!countErr && count > 0) {
            mapsWithChangedToken.push({
              oldId: oldCh.id,
              map: oldMap,
              subSeed: oldSub,
              name: oldCh.name || `Map ${oldMap}`,
              count: count,
            });
          }
        }
      }
    }

    const removedWithScores = removedChallenges.filter((r) => r.count > 0);
    if (mapsWithChangedToken.length > 0 || removedWithScores.length > 0) {
      const warningParts = [];
      mapsWithChangedToken.forEach((m) =>
        warningParts.push(`• Map ${m.map} Seed ${m.subSeed} (${m.name}): เปลี่ยนลิงก์ (มีคะแนนเดิม ${m.count} รายการ)`)
      );
      removedWithScores.forEach((r) =>
        warningParts.push(`• Map ${r.map} Seed ${r.subSeed} (${r.name}): ถูกลดจำนวน Seed ออก (มีคะแนนเดิม ${r.count} รายการ)`)
      );

      const confirmMsg =
        `⚠️ มีการเปลี่ยนแปลงลิงก์หรือจำนวน Seed ที่มีคะแนนเดิมค้างอยู่:\n\n` +
        warningParts.join("\n") +
        `\n\nคะแนนเดิมใน Seed เหล่านี้จะถูกล้างออก คุณยืนยันที่จะบันทึกหรือไม่?`;

      if (!confirm(confirmMsg)) {
        return;
      }

      for (const m of mapsWithChangedToken) {
        await adminDb.from("scores").delete().eq("challenge_id", m.oldId);
      }
    }

    // ลบ sub-seed ที่ถูกลดจำนวนออก
    for (const r of removedChallenges) {
      await adminDb.from("challenges").delete().eq("id", r.oldId);
    }

    // 1. อัปเดตข้อมูลสัปดาห์
    const { error: wErr } = await adminDb
      .from("weeks")
      .update({
        title,
        header_info: headerInfo,
        start_date: startDate,
        end_date: endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", weekId);

    if (wErr) throw wErr;

    // 2. อัปเดตข้อมูล Challenges ทั้งหมด (รองรับทั้ง DB ใหม่และ DB เก่าที่ยังไม่ migrate)
    let { error: chErr } = await adminDb
      .from("challenges")
      .upsert(challengesToUpsert, { onConflict: "week_id,map_number,sub_seed_number" });

    if (
      chErr &&
      (chErr.message?.includes("map_number") ||
        chErr.message?.includes("sub_seed_number") ||
        chErr.message?.includes("game_type") ||
        chErr.message?.includes("on conflict") ||
        chErr.code === "PGRST204" ||
        chErr.code === "42P10")
    ) {
      if (collected.usesAdvanced) {
        throw new Error(
          "ฐานข้อมูล Supabase ยังไม่ได้รันคำสั่ง Migration สำหรับ Multi-Seed และ Game Type (กรุณารัน SQL Migration จากไฟล์ supabase_schema.sql ก่อนใช้งานฟีเจอร์นี้)"
        );
      }
      const legacyUpserts = challengesToUpsert.map(({ map_number, sub_seed_number, game_type, ...rest }) => rest);
      const { error: legacyErr } = await adminDb
        .from("challenges")
        .upsert(legacyUpserts, { onConflict: "week_id,seed_number" });
      if (legacyErr) throw legacyErr;
    } else if (chErr) {
      throw chErr;
    }

    alert(
      "✅ บันทึกการแก้ไขสัปดาห์และ 7 Maps เรียบร้อยแล้ว!" +
        (mapsWithChangedToken.length > 0 ? "\n(ล้างคะแนนเก่าของ Seed ที่เปลี่ยนลิงก์เรียบร้อยแล้ว)" : "")
    );
    closeEditModal();
    loadWeeks();
  } catch (err) {
    console.error("Edit Week Error:", err);
    alert("เกิดข้อผิดพลาด: " + err.message);
  }
});

/**
 * 4. สร้างสัปดาห์ใหม่พร้อม 7 Maps (รองรับ Multi-seed & Game Type)
 */
const createMapsContainer = document.getElementById("mapsInputsContainer");
renderMapBuilder(createMapsContainer, "create", []);

createWeekForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!adminDb) {
    alert("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    showLogin();
    return;
  }

  const title = document.getElementById("weekTitle").value.trim();
  const headerInfo = document.getElementById("weekHeaderInfo").value.trim();
  const startDateVal = document.getElementById("weekStartDate")?.value;
  const startDate = startDateVal ? new Date(startDateVal).toISOString() : null;
  const endDateVal = document.getElementById("weekEndDate").value;
  const endDate = endDateVal ? new Date(endDateVal).toISOString() : null;
  const isInitialActive = document.querySelector('input[name="weekInitialStatus"]:checked')?.value === "active";

  const collected = collectMapBuilderData(createMapsContainer, "create");
  if (!collected) return;

  try {
    // 1. ถ้าเลือกเป็น Active ตอนสร้าง ให้ตั้งสัปดาห์อื่น ๆ เป็น is_active = false
    if (isInitialActive) {
      await adminDb.from("weeks").update({ is_active: false }).neq("id", 0);
    }

    // 2. สร้างสัปดาห์ใหม่
    const { data: newWeek, error: wErr } = await adminDb
      .from("weeks")
      .insert({
        title,
        header_info: headerInfo,
        start_date: startDate,
        end_date: endDate,
        is_active: isInitialActive,
        is_frozen: false,
      })
      .select()
      .single();

    if (wErr) throw wErr;

    // 3. แทรก Challenges
    const challengesToInsert = collected.items.map((c) => ({
      week_id: newWeek.id,
      ...c,
    }));

    let { error: chErr } = await adminDb.from("challenges").insert(challengesToInsert);
    if (
      chErr &&
      (chErr.message?.includes("map_number") ||
        chErr.message?.includes("sub_seed_number") ||
        chErr.message?.includes("game_type") ||
        chErr.code === "PGRST204")
    ) {
      if (collected.usesAdvanced) {
        await adminDb.from("weeks").delete().eq("id", newWeek.id);
        throw new Error(
          "ฐานข้อมูล Supabase ยังไม่ได้รันคำสั่ง Migration สำหรับ Multi-Seed และ Game Type (กรุณารัน SQL Migration จากไฟล์ supabase_schema.sql ก่อนใช้งานฟีเจอร์นี้)"
        );
      }
      const legacyInsert = challengesToInsert.map(({ map_number, sub_seed_number, game_type, ...rest }) => rest);
      const { error: legacyErr } = await adminDb.from("challenges").insert(legacyInsert);
      if (legacyErr) throw legacyErr;
    } else if (chErr) {
      throw chErr;
    }

    alert(`✅ สร้างสัปดาห์ "${title}" ${isInitialActive ? "(เปิดแข่งทันที)" : "(บันทึกเป็นแบบร่าง)"} สำเร็จแล้ว!`);
    createWeekForm.reset();
    renderMapBuilder(createMapsContainer, "create", []);
    loadWeeks();
  } catch (err) {
    console.error("Error creating week:", err);
    alert("เกิดข้อผิดพลาดในการสร้างสัปดาห์: " + (err.message || err));
  }
});

window.setActiveWeek = async function (id) {
  if (!adminDb) return;
  if (!confirm("ต้องการเปิดสัปดาห์นี้ให้เป็น 'สัปดาห์ปัจจุบัน (Active)' และแสดงบนหน้าแรกทันทีใช่หรือไม่?")) {
    return;
  }
  await adminDb.from("weeks").update({ is_active: false }).neq("id", 0);
  await adminDb.from("weeks").update({ is_active: true }).eq("id", id);
  loadWeeks();
};

window.setDraftWeek = async function (id) {
  if (!adminDb) return;
  if (
    !confirm(
      "ต้องการเปลี่ยนสถานะสัปดาห์นี้ให้เป็น 'แบบร่าง (Draft)' หรือไม่?\n\n(คนดูในหน้าแรกจะไม่เห็นสัปดาห์นี้ และระบบจะล้างวันเริ่มแข่งอัตโนมัติจนกว่าคุณจะกำหนดใหม่หรือกดเปิดแข่งขันอีกครั้ง)"
    )
  ) {
    return;
  }
  const { error } = await adminDb
    .from("weeks")
    .update({ is_active: false, start_date: null })
    .eq("id", id);
  if (error) {
    alert("เกิดข้อผิดพลาด: " + error.message);
    return;
  }
  loadWeeks();
};

window.deleteWeek = async function (id, title) {
  if (!adminDb) return;
  const resolvedTitle = title || weeksById.get(id)?.title || `Week ${id}`;
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบสัปดาห์ "${resolvedTitle}"? ข้อมูลคะแนนทั้งหมดจะหายไป`)) return;
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
  div.textContent = text ?? "";
  return div.innerHTML.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

// ==========================================
// 5. จัดการคะแนนผู้เล่น (Score Manager)
// ==========================================
let currentScoresWeekId = null;
let currentWeekChallenges = [];
let currentWeekScores = [];

function formatDuration(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return "";
  const s = Math.round(Number(sec));
  const mins = Math.floor(s / 60);
  const remainingSecs = s % 60;
  if (mins === 0) return `${remainingSecs}s`;
  return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
}

window.openScoresModal = async function (weekId, weekTitle) {
  currentScoresWeekId = weekId;
  const resolvedTitle = weekTitle || weeksById.get(weekId)?.title || `Week ${weekId}`;
  const modal = document.getElementById("scoresModal");
  document.getElementById("scoresModalTitle").textContent = `📊 จัดการคะแนนผู้เล่น`;
  document.getElementById("scoresModalSubtitle").textContent = `สัปดาห์: ${resolvedTitle}`;
  document.getElementById("scoresSearchInput").value = "";
  document.getElementById("scoresFilterMap").value = "all";
  if (document.getElementById("scoresSortBy")) {
    document.getElementById("scoresSortBy").value = "time_desc";
  }

  modal.classList.add("open");
  await loadScoresForWeek(weekId);
};

window.closeScoresModal = function () {
  document.getElementById("scoresModal").classList.remove("open");
};

async function loadScoresForWeek(weekId) {
  if (!adminDb) return;
  const tbody = document.getElementById("scoresTableBody");
  tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 24px; color: #64748b;">⏳ กำลังโหลดข้อมูลคะแนน...</td></tr>`;

  try {
    // 1. ดึง Challenges ทั้งหมดของสัปดาห์นี้
    const { data: challenges, error: chErr } = await adminDb
      .from("challenges")
      .select("*")
      .eq("week_id", weekId)
      .order("seed_number", { ascending: true });

    if (chErr) throw chErr;
    currentWeekChallenges = sortChallenges(challenges || []);

    if (currentWeekChallenges.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 24px; color: #94a3b8;">ไม่พบข้อมูล Map ในสัปดาห์นี้</td></tr>`;
      return;
    }

    const chIds = currentWeekChallenges.map((c) => c.id);

    // 2. ดึงคะแนนทั้งหมดของ Challenges ในสัปดาห์นี้ พร้อมข้อมูล players, played_at, total_time
    let { data: scores, error: scErr } = await fetchAllRows(() =>
      adminDb
        .from("scores")
        .select("id, challenge_id, player_id, total_score, r1, r2, r3, r4, r5, played_at, total_time, updated_at, players(id, username)")
        .in("challenge_id", chIds)
        .order("id", { ascending: true })
    );

    if (scErr && (scErr.message?.includes("played_at") || scErr.code === "PGRST204")) {
      const fb = await fetchAllRows(() =>
        adminDb
          .from("scores")
          .select("id, challenge_id, player_id, total_score, r1, r2, r3, r4, r5, updated_at, players(id, username)")
          .in("challenge_id", chIds)
          .order("id", { ascending: true })
      );
      scores = fb.data;
      scErr = fb.error;
    }

    if (scErr) throw scErr;
    currentWeekScores = scores || [];

    renderScoresList();
  } catch (err) {
    console.error("Load Scores Error:", err);
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: red; padding: 24px;">เกิดข้อผิดพลาดในการโหลดคะแนน: ${escapeHtml(err.message)}</td></tr>`;
  }
}

window.toggleScoresSort = function (type) {
  const select = document.getElementById("scoresSortBy");
  if (!select) return;
  const current = select.value;

  if (type === "time") {
    select.value = current === "time_desc" ? "time_asc" : "time_desc";
  } else if (type === "score") {
    select.value = current === "score_desc" ? "score_asc" : "score_desc";
  } else if (type === "player") {
    select.value = current === "player_asc" ? "player_desc" : "player_asc";
  } else if (type === "map") {
    select.value = current === "map_asc" ? "map_desc" : "map_asc";
  }
  renderScoresList();
};

window.renderScoresList = function () {
  const mapFilter = document.getElementById("scoresFilterMap").value;
  const searchFilter = (document.getElementById("scoresSearchInput").value || "").trim().toLowerCase();
  const sortBy = document.getElementById("scoresSortBy")?.value || "time_desc";
  const tbody = document.getElementById("scoresTableBody");

  const chMap = {};
  currentWeekChallenges.forEach((c) => {
    chMap[c.id] = c;
  });

  const filtered = currentWeekScores.filter((s) => {
    const ch = chMap[s.challenge_id];
    if (mapFilter !== "all") {
      if (!ch || String(getMapNum(ch)) !== mapFilter) return false;
    }
    if (searchFilter) {
      const uName = (s.players?.username || "").toLowerCase();
      if (!uName.includes(searchFilter)) return false;
    }
    return true;
  });

  document.getElementById("scoresTotalCount").textContent = filtered.length;

  // Update sort icons in table header
  const iconMap = { player: "", map: "", time: "", score: "" };
  if (sortBy === "time_desc") iconMap.time = "▼";
  else if (sortBy === "time_asc") iconMap.time = "▲";
  else if (sortBy === "score_desc") iconMap.score = "▼";
  else if (sortBy === "score_asc") iconMap.score = "▲";
  else if (sortBy === "player_asc") iconMap.player = "▲";
  else if (sortBy === "player_desc") iconMap.player = "▼";
  else if (sortBy === "map_asc") iconMap.map = "▲";
  else if (sortBy === "map_desc") iconMap.map = "▼";

  if (document.getElementById("sortIconPlayer")) document.getElementById("sortIconPlayer").textContent = iconMap.player;
  if (document.getElementById("sortIconMap")) document.getElementById("sortIconMap").textContent = iconMap.map;
  if (document.getElementById("sortIconTime")) document.getElementById("sortIconTime").textContent = iconMap.time;
  if (document.getElementById("sortIconScore")) document.getElementById("sortIconScore").textContent = iconMap.score;

  // Sorting
  filtered.sort((a, b) => {
    const chA = chMap[a.challenge_id] || { seed_number: 99 };
    const chB = chMap[b.challenge_id] || { seed_number: 99 };
    const nameA = (a.players?.username || "").toLowerCase();
    const nameB = (b.players?.username || "").toLowerCase();
    const totalA = a.total_score ?? ((a.r1 || 0) + (a.r2 || 0) + (a.r3 || 0) + (a.r4 || 0) + (a.r5 || 0));
    const totalB = b.total_score ?? ((b.r1 || 0) + (b.r2 || 0) + (b.r3 || 0) + (b.r4 || 0) + (b.r5 || 0));

    const timeA = a.played_at ? new Date(a.played_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : 0);
    const timeB = b.played_at ? new Date(b.played_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : 0);

    const durA = Number(a.total_time) || 999999;
    const durB = Number(b.total_time) || 999999;

    switch (sortBy) {
      case "time_desc":
        return timeB - timeA || totalB - totalA;
      case "time_asc":
        return timeA - timeB || totalB - totalA;
      case "score_desc":
        return totalB - totalA || timeB - timeA;
      case "score_asc":
        return totalA - totalB || timeB - timeA;
      case "map_asc":
        return getMapNum(chA) - getMapNum(chB) || getSubSeedNum(chA) - getSubSeedNum(chB) || totalB - totalA;
      case "map_desc":
        return getMapNum(chB) - getMapNum(chA) || getSubSeedNum(chB) - getSubSeedNum(chA) || totalB - totalA;
      case "player_asc":
        return nameA.localeCompare(nameB) || totalB - totalA;
      case "player_desc":
        return nameB.localeCompare(nameA) || totalB - totalA;
      case "duration_asc":
        return durA - durB || totalB - totalA;
      default:
        return timeB - timeA || totalB - totalA;
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 24px; color: #94a3b8;">ไม่พบคะแนนที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
    return;
  }

  const mapSeedCounts = new Map();
  currentWeekChallenges.forEach((c) => {
    const m = getMapNum(c);
    mapSeedCounts.set(m, (mapSeedCounts.get(m) || 0) + 1);
  });

  tbody.innerHTML = filtered
    .map((s, idx) => {
      const ch = chMap[s.challenge_id] || { seed_number: "?", name: "Unknown" };
      const mapNum = getMapNum(ch);
      const subSeed = getSubSeedNum(ch);
      const isMulti = (mapSeedCounts.get(mapNum) || 1) > 1;
      const isCountry = getGameType(ch) === "country_count";
      const username = s.players?.username || `Player #${s.player_id}`;
      const total = s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));

      let timeDisplay = `<span style="color: #94a3b8; font-size: 0.78rem;">-</span>`;
      if (s.played_at) {
        const d = new Date(s.played_at);
        if (!isNaN(d.getTime())) {
          const dateStr = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" });
          const timeStr = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
          timeDisplay = `
            <div style="font-weight: 600; color: #1e293b; font-size: 0.8rem;">${dateStr}</div>
            <div style="font-size: 0.72rem; color: #64748b;">🕐 ${timeStr} น.</div>
          `;
        }
      } else if (s.updated_at) {
        const d = new Date(s.updated_at);
        if (!isNaN(d.getTime())) {
          const dateStr = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
          const timeStr = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
          timeDisplay = `
            <div style="color: #64748b; font-size: 0.75rem;" title="เวลาที่บันทึกลงระบบ">${dateStr} ${timeStr}</div>
            <div style="font-size: 0.68rem; color: #94a3b8;">(เวลา Sync)</div>
          `;
        }
      }

      const durText = s.total_time ? `<div style="font-size: 0.72rem; color: #0284c7; font-weight: 600; margin-top: 2px;">⚡ ${formatDuration(s.total_time)}</div>` : "";
      const fmtRound = (val) =>
        isCountry ? (Number(val) === 1 ? "✅ 1" : "❌ 0") : (val ?? 0).toLocaleString();
      const totalLabel = isCountry ? `${total} / 5` : total.toLocaleString();

      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="text-align: center; padding: 8px; color: #64748b; font-size: 0.8rem;">${idx + 1}</td>
          <td style="padding: 8px 12px; font-weight: bold; color: #1e293b;">
            <div>${escapeHtml(username)}</div>
          </td>
          <td style="text-align: center; padding: 8px;">
            <span style="display: inline-block; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 0.78rem; font-weight: 600;">
              Map ${mapNum}${isMulti ? ` (S${subSeed})` : ""}${isCountry ? " 🌍" : ""}
            </span>
            <div style="font-size: 0.73rem; color: #64748b; margin-top: 2px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${renderFlags(escapeHtml(ch.name || ""))}</div>
          </td>
          <td style="text-align: center; padding: 6px 8px; background: #fffbeb;">
            ${timeDisplay}
          </td>
          <td style="text-align: center; padding: 8px; color: #475569;">${fmtRound(s.r1)}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${fmtRound(s.r2)}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${fmtRound(s.r3)}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${fmtRound(s.r4)}</td>
          <td style="text-align: center; padding: 8px; color: #475569;">${fmtRound(s.r5)}</td>
          <td style="text-align: center; padding: 8px; font-weight: bold; background: #eff6ff; color: #1e3a8a;">
            <div>${totalLabel}</div>
            ${durText}
          </td>
          <td style="text-align: center; padding: 8px;">
            <div style="display: flex; gap: 4px; justify-content: center;">
              <button class="btn btn-delete-score" onclick="deleteScore(${s.id})" title="ลบคะแนนแมพนี้เฉพาะรายการนี้">
                🗑️ ลบ
              </button>
              <button class="btn btn-dq" onclick="disqualifyPlayerByScore(${s.id})" title="ตัดสิทธิ์ผู้เล่นคนนี้ ล้างคะแนนทุกแมพในสัปดาห์นี้">
                🚫 DQ
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

    // บันทึกรายชื่อผู้เล่นที่ถูก DQ ไว้ไม่ให้ sync.js ดึงคะแนนกลับมาซ้ำในสัปดาห์นี้
    let dqSaved = false;
    try {
      const { error: dqErr } = await adminDb.from("disqualified_players").upsert(
        {
          week_id: currentScoresWeekId,
          player_id: playerId,
          reason: "DQ by admin",
        },
        { onConflict: "week_id,player_id" }
      );
      if (!dqErr) dqSaved = true;
    } catch (e) {}

    currentWeekScores = currentWeekScores.filter((x) => x.player_id !== playerId);
    renderScoresList();
    alert(
      `✅ ตัดสิทธิ์และล้างคะแนนของ "${pseudo}" ในสัปดาห์นี้เรียบร้อยแล้ว` +
        (dqSaved ? "" : "\n(หมายเหตุ: หากยังไม่ได้รัน SQL ตาราง disqualified_players ระบบ Sync รอบถัดไปอาจดึงคะแนนผู้เล่นนี้กลับมา)")
    );
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
  const mapSeedCounts = new Map();
  currentWeekChallenges.forEach((c) => {
    const m = getMapNum(c);
    mapSeedCounts.set(m, (mapSeedCounts.get(m) || 0) + 1);
  });

  const select = document.getElementById("manualMapSelect");
  select.innerHTML = currentWeekChallenges
    .map((c) => {
      const m = getMapNum(c);
      const sub = getSubSeedNum(c);
      const multiTag = (mapSeedCounts.get(m) || 1) > 1 ? ` (Seed ${sub})` : "";
      const typeTag = getGameType(c) === "country_count" ? " [🌍 Country Count]" : "";
      return `<option value="${c.id}">Map ${m}${multiTag}: ${escapeHtml(c.name || "")}${typeTag}</option>`;
    })
    .join("");

  document.getElementById("manualUsername").value = "";
  ["manualR1", "manualR2", "manualR3", "manualR4", "manualR5"].forEach((id) => {
    document.getElementById(id).value = "0";
  });
  onManualMapChange();

  document.getElementById("manualScoreModal").classList.add("open");
};

window.onManualMapChange = function () {
  const challengeId = Number(document.getElementById("manualMapSelect")?.value);
  const ch = currentWeekChallenges.find((c) => c.id === challengeId);
  const isCountry = getGameType(ch) === "country_count";
  const maxRound = isCountry ? 1 : 5000;
  const maxTotalEl = document.getElementById("manualMaxTotalLabel");
  const hintEl = document.getElementById("manualGameTypeHint");

  if (maxTotalEl) maxTotalEl.textContent = isCountry ? "5 (ประเทศ)" : "25,000";
  if (hintEl) {
    hintEl.textContent = isCountry
      ? "🌍 โหมด Country Count: ใส่ 1 = ถูกประเทศ, 0 = ผิดประเทศ"
      : "📊 โหมด Standard: ใส่คะแนน 0 - 5,000 ต่อรอบ";
  }

  document.querySelectorAll(".manual-round-lbl").forEach((lbl, idx) => {
    lbl.textContent = isCountry ? `R${idx + 1} (0/1):` : `R${idx + 1} (0-5k):`;
  });

  ["manualR1", "manualR2", "manualR3", "manualR4", "manualR5"].forEach((id) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.max = String(maxRound);
    if (Number(inp.value) > maxRound) inp.value = String(maxRound);
  });

  calcManualTotal();
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
    const ch = currentWeekChallenges.find((c) => c.id === challengeId);
    const maxRound = getGameType(ch) === "country_count" ? 1 : 5000;
    const username = document.getElementById("manualUsername").value.trim();
    const r1 = Math.min(maxRound, Math.max(0, parseInt(document.getElementById("manualR1").value, 10) || 0));
    const r2 = Math.min(maxRound, Math.max(0, parseInt(document.getElementById("manualR2").value, 10) || 0));
    const r3 = Math.min(maxRound, Math.max(0, parseInt(document.getElementById("manualR3").value, 10) || 0));
    const r4 = Math.min(maxRound, Math.max(0, parseInt(document.getElementById("manualR4").value, 10) || 0));
    const r5 = Math.min(maxRound, Math.max(0, parseInt(document.getElementById("manualR5").value, 10) || 0));
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

      // 2. บันทึกคะแนนลงตาราง scores (upsert พร้อมทำเครื่องหมาย is_manual เพื่อป้องกัน Sync เขียนทับ)
      const scorePayload = {
        challenge_id: challengeId,
        player_id: playerId,
        r1,
        r2,
        r3,
        r4,
        r5,
        total_score: total,
        is_manual: true,
        updated_at: new Date().toISOString(),
      };
      let { error: sErr } = await adminDb
        .from("scores")
        .upsert(scorePayload, { onConflict: "challenge_id,player_id" });

      if (sErr && (sErr.message?.includes("is_manual") || sErr.code === "PGRST204")) {
        const { is_manual, ...fallbackPayload } = scorePayload;
        const fb = await adminDb
          .from("scores")
          .upsert(fallbackPayload, { onConflict: "challenge_id,player_id" });
        sErr = fb.error;
      }

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
    const { data: scores, error } = await fetchAllRows(() =>
      adminDb
        .from("scores")
        .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, updated_at, challenges(seed_number, map_number, sub_seed_number, game_type, name, weeks(title, is_frozen)), players(username)")
        .order("id", { ascending: false })
    );

    if (error) throw error;
    if (!scores || scores.length === 0) {
      alert("ยังไม่มีข้อมูลคะแนนในระบบที่จะส่งออก");
      return;
    }

    const headers = [
      "Week Title",
      "Week Status",
      "Map Number",
      "Sub Seed",
      "Game Type",
      "Map Name",
      "Player Pseudo",
      "Player User ID",
      "Round 1",
      "Round 2",
      "Round 3",
      "Round 4",
      "Round 5",
      "Total Score",
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
        `"Map ${getMapNum(ch) || ""}"`,
        getSubSeedNum(ch),
        `"${getGameType(ch)}"`,
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
  const resolvedTitle = weekTitle || weeksById.get(weekId)?.title || `Week ${weekId}`;
  const modal = document.getElementById("adjustmentsModal");
  document.getElementById("adjModalTitle").textContent = "🛠️ กฎปรับคะแนนพิเศษ (Score Adjustments)";
  document.getElementById("adjModalSubtitle").textContent = `สัปดาห์: ${resolvedTitle}`;
  modal.classList.add("open");

  const { data: challenges } = await adminDb
    .from("challenges")
    .select("*")
    .eq("week_id", weekId)
    .order("seed_number", { ascending: true });

  currentAdjChallenges = sortChallenges(challenges || []);
  const mapSeedCounts = new Map();
  currentAdjChallenges.forEach((c) => {
    const m = getMapNum(c);
    mapSeedCounts.set(m, (mapSeedCounts.get(m) || 0) + 1);
  });

  const mapSelect = document.getElementById("adjMapSelect");
  mapSelect.innerHTML = currentAdjChallenges
    .map((c) => {
      const m = getMapNum(c);
      const sub = getSubSeedNum(c);
      const seedTag = (mapSeedCounts.get(m) || 1) > 1 ? ` (Seed ${sub})` : "";
      const typeTag = getGameType(c) === "country_count" ? " [🌍 Country Count]" : "";
      return `<option value="${c.id}">Map ${m}${seedTag}: ${escapeHtml(c.name || `Map ${m}`)}${typeTag}</option>`;
    })
    .join("");
  mapSelect.onchange = updateRuleInputsVisibility;

  updateRuleInputsVisibility();
  await loadActiveAdjustments(weekId);
};

window.closeAdjustmentsModal = function () {
  document.getElementById("adjustmentsModal")?.classList.remove("open");
};

window.updateRuleInputsVisibility = function () {
  const ruleSelect = document.getElementById("adjRuleType");
  const selectedChId = Number(document.getElementById("adjMapSelect")?.value);
  const selectedCh = currentAdjChallenges.find((c) => c.id === selectedChId);
  const isCountry = getGameType(selectedCh) === "country_count";

  if (isCountry && ruleSelect.value !== "void_round") {
    ruleSelect.value = "void_round";
  }

  const ruleType = ruleSelect.value;
  const minCont = document.getElementById("adjMinScoreContainer");
  const targetCont = document.getElementById("adjTargetScoreContainer");
  const bonusCont = document.getElementById("adjBonusContainer");
  const targetInp = document.getElementById("adjTargetScore");

  if (isCountry) {
    minCont.style.display = "none";
    targetCont.style.display = "block";
    bonusCont.style.display = "none";
    if (targetInp) {
      targetInp.max = "1";
      targetInp.value = "1";
    }
    return;
  }

  if (targetInp) {
    targetInp.max = "5000";
    if (Number(targetInp.value) <= 1) targetInp.value = "5000";
  }

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
        const mNum = getMapNum(ch) || "?";
        const subNum = getSubSeedNum(ch);
        const hasMulti = currentAdjChallenges.filter((x) => getMapNum(x) === mNum).length > 1;
        const isCountry = getGameType(ch) === "country_count";
        let ruleDesc = "";
        if (isCountry && adj.rule_type === "void_round") {
          ruleDesc = `ให้ทุกคนทายถูก <strong style="color: #16a34a;">✅ 1</strong> (Void Round)`;
        } else if (adj.rule_type === "threshold_to_max") {
          ruleDesc = `คะแนน &ge; <strong>${adj.min_score.toLocaleString()}</strong> &rarr; ปรับเป็น <strong style="color: #16a34a;">${adj.target_score.toLocaleString()}</strong>`;
        } else if (adj.rule_type === "void_round") {
          ruleDesc = `ให้ทุกคนเต็ม <strong style="color: #16a34a;">${adj.target_score.toLocaleString()}</strong> (Void Round)`;
        } else if (adj.rule_type === "bonus_points") {
          ruleDesc = `บวกแต้มชดเชย <strong style="color: #0284c7;">+${adj.bonus_points.toLocaleString()}</strong>`;
        }

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="text-align: center; font-weight: bold; color: #00247d;">Map ${mNum}${hasMulti ? ` (S${subNum})` : ""}</td>
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
    const ch = currentAdjChallenges.find((c) => c.id === challenge_id);
    const isCountry = getGameType(ch) === "country_count";
    const round_number = Number(document.getElementById("adjRoundSelect").value);
    const rule_type = document.getElementById("adjRuleType").value;

    if (isCountry && rule_type !== "void_round") {
      alert("⚠️ แมพโหมด Country Count รองรับเฉพาะกฎ 'Void Round' (ให้ทุกคนทายถูก ✅ 1 ในรอบนั้น)");
      return;
    }

    const min_score = Number(document.getElementById("adjMinScore").value) || 4990;
    const target_score = isCountry
      ? 1
      : Number(document.getElementById("adjTargetScore").value) || 5000;
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

        if (isCountry) {
          if (rule_type === "void_round" && s[rKey] !== 1) {
            newRoundScore = 1;
            changed = true;
          }
        } else {
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

// ==========================================
// ฟังก์ชันกลางคำนวณคะแนน Head-to-Head ต่อ 1 Seed (รองรับทั้ง Standard และ Country Count)
// ==========================================
function scoreSingleSeedList(pList, gameType = "standard") {
  if (!pList || pList.length === 0) return [];
  const isCountryCount = gameType === "country_count";

  for (let m = 0; m < 6; m++) {
    const maxScore = isCountryCount ? (m < 5 ? 1 : 5) : (m < 5 ? 5000 : 25000);

    pList.forEach((p) => {
      p.phantoms = p.phantoms || [];
      p.points = p.points || [];
      p.h2h = p.h2h || [];

      const raw = p.raw[m];
      if (isCountryCount) {
        p.phantoms[m] = raw; // No Phantom
      } else {
        const missing = Math.max(0, maxScore - raw);
        p.phantoms[m] = raw + 0.1 * missing;
      }
    });

    pList.forEach((p, i) => {
      let pts = 0;
      let wins = 0;
      let ties = 0;
      let losses = 0;
      const pRaw = p.raw[m];
      const pPhan = p.phantoms[m];

      if (isCountryCount && pRaw === 0) {
        // กฎ Country Count: ถ้าได้ 0 ในรอบนั้น (หรือ 0 ใน Total) ตีตกเป็น 0 แต้มทันที
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
              pts += 1;
              wins += 1;
            } else if (pRaw === oppRaw) {
              pts += 0.5;
              ties += 1;
            } else {
              losses += 1;
            }
          } else {
            if (pRaw > oppPhan && oppRaw <= pPhan) {
              pts += 1;
              wins += 1;
            } else if (pRaw <= oppPhan && oppRaw <= pPhan) {
              pts += 0.5;
              ties += 1;
            } else {
              losses += 1;
            }
          }
        });
        p.points[m] = pts;
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

function computeMapRankings(pScores, gameType = "standard") {
  if (!pScores || pScores.length === 0) return new Map();

  const pList = pScores.map((s) => ({
    userId: s.player_id,
    raw: [
      Number(s.r1) || 0,
      Number(s.r2) || 0,
      Number(s.r3) || 0,
      Number(s.r4) || 0,
      Number(s.r5) || 0,
      Number(s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0))) || 0,
    ],
    phantoms: [],
    points: [],
    h2h: [],
  }));

  const maxRounds = [0, 1, 2, 3, 4].map((m) => Math.max(...pList.map((p) => p.raw[m])));
  scoreSingleSeedList(pList, gameType);

  const resultMap = new Map();
  pList.forEach((p) => {
    let roundWins = 0;
    for (let m = 0; m < 5; m++) {
      if (p.raw[m] === maxRounds[m] && maxRounds[m] > 0) {
        roundWins++;
      }
    }

    resultMap.set(p.userId, {
      mapRank: p.mapRank,
      isMapWin: p.mapRank === 1,
      roundWins: roundWins,
      maxRounds: maxRounds,
    });
  });

  return resultMap;
}

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
  tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center; color: #64748b;">⏳ กำลังโหลดรายชื่อผู้เล่น...</td></tr>`;

  try {
    const { data: players, error: pErr } = await fetchAllRows(() =>
      adminDb
        .from("players")
        .select("id, username, updated_at")
        .order("username", { ascending: true })
        .order("id", { ascending: true })
    );

    if (pErr) throw pErr;
    allDirectoryPlayers = players || [];
    document.getElementById("playerDirTotalCount").textContent = allDirectoryPlayers.length;

    const { data: challengesMeta } = await fetchAllRows(() =>
      adminDb
        .from("challenges")
        .select("id, game_type")
        .order("id", { ascending: true })
    );

    const chTypeMap = new Map();
    (challengesMeta || []).forEach((c) => chTypeMap.set(c.id, getGameType(c)));

    const { data: scores, error: scErr } = await fetchAllRows(() =>
      adminDb
        .from("scores")
        .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score")
        .order("id", { ascending: true })
    );

    if (scErr) throw scErr;

    const scoresByChallenge = new Map();
    (scores || []).forEach((s) => {
      if (!scoresByChallenge.has(s.challenge_id)) scoresByChallenge.set(s.challenge_id, []);
      scoresByChallenge.get(s.challenge_id).push(s);
    });

    const challengeRankingsMap = new Map();
    scoresByChallenge.forEach((chScores, chId) => {
      challengeRankingsMap.set(chId, computeMapRankings(chScores, chTypeMap.get(chId) || "standard"));
    });

    const statsMap = new Map();
    (scores || []).forEach((s) => {
      if (!statsMap.has(s.player_id)) {
        statsMap.set(s.player_id, { maps: 0, count5k: 0, count25k: 0, mapWins: 0, roundWins: 0 });
      }
      const st = statsMap.get(s.player_id);
      st.maps++;
      const gType = chTypeMap.get(s.challenge_id) || "standard";
      if (gType !== "country_count") {
        [s.r1, s.r2, s.r3, s.r4, s.r5].forEach((r) => {
          if (r === 5000) st.count5k++;
        });
        if (s.total_score === 25000) st.count25k++;
      }

      const chMap = challengeRankingsMap.get(s.challenge_id);
      const rInfo = chMap?.get(s.player_id);
      if (rInfo) {
        if (rInfo.isMapWin) st.mapWins++;
        st.roundWins += rInfo.roundWins;
      }
    });

    allDirectoryPlayers.forEach((p) => {
      p.stats = statsMap.get(p.id) || { maps: 0, count5k: 0, count25k: 0, mapWins: 0, roundWins: 0 };
    });

    renderPlayerDirectoryList();
  } catch (err) {
    console.error("Load player directory error:", err);
    tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center; color: #94a3b8;">ไม่พบผู้เล่นที่ค้นหา</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((p, idx) => {
      const mapWinsTag = p.stats.mapWins > 0 
        ? `<span style="font-weight: 800; color: #b45309;">${p.stats.mapWins} 🥇</span>` 
        : `<span style="color: #94a3b8;">0</span>`;
      const roundWinsTag = p.stats.roundWins > 0 
        ? `<span style="font-weight: 800; color: #0284c7;">${p.stats.roundWins} 🎯</span>` 
        : `<span style="color: #94a3b8;">0</span>`;

      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="text-align: center; color: #64748b;">${idx + 1}</td>
          <td style="text-align: left; padding: 8px 12px; font-weight: bold; color: #00247d;">${escapeHtml(p.username)}</td>
          <td style="text-align: center; font-family: monospace; font-size: 0.78rem; color: #64748b;">${escapeHtml(p.id)}</td>
          <td style="text-align: center;">${p.stats.maps} แมพ</td>
          <td style="text-align: center;">${mapWinsTag}</td>
          <td style="text-align: center;">${roundWinsTag}</td>
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
  const mapWinsEl = document.getElementById("admProfMapWins");
  const roundWinsEl = document.getElementById("admProfRoundWins");
  const count5kEl = document.getElementById("admProf5kRounds");
  const count25kEl = document.getElementById("admProf25kGames");
  const tbody = document.getElementById("admProfHistoryTableBody");

  usernameEl.textContent = "Loading Profile...";
  idSub.textContent = `User ID: ${playerId}`;
  geoguessrLink.href = `https://www.geoguessr.com/user/${playerId}`;
  tbody.innerHTML = `<tr><td colspan="9" style="padding: 24px; text-align: center; color: #64748b;">กำลังโหลดประวัติทุกสัปดาห์...</td></tr>`;

  modal.classList.add("open");

  try {
    const { data: scores, error: scErr } = await fetchAllRows(() =>
      adminDb
        .from("scores")
        .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, challenges(*, weeks(*)), players(username)")
        .eq("player_id", playerId)
        .order("id", { ascending: true })
    );

    if (scErr) throw scErr;

    const allScores = scores || [];
    const username = allScores[0]?.players?.username || "Player";
    usernameEl.textContent = username;

    // Fetch all scores for the challenges this player participated in to compute Map Wins & Round Wins accurately
    const chIds = [...new Set(allScores.map((s) => s.challenge_id))];
    const chRankingsMap = new Map();

    if (chIds.length > 0) {
      const { data: relatedScores } = await fetchAllRows(() =>
        adminDb
          .from("scores")
          .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score")
          .in("challenge_id", chIds)
          .order("id", { ascending: true })
      );

      const chTypeById = new Map();
      allScores.forEach((s) => {
        if (s.challenges) chTypeById.set(s.challenge_id, getGameType(s.challenges));
      });

      const byCh = new Map();
      (relatedScores || []).forEach((s) => {
        if (!byCh.has(s.challenge_id)) byCh.set(s.challenge_id, []);
        byCh.get(s.challenge_id).push(s);
      });

      byCh.forEach((scoresList, cId) => {
        chRankingsMap.set(cId, computeMapRankings(scoresList, chTypeById.get(cId) || "standard"));
      });
    }

    let count5k = 0;
    let count25k = 0;
    let countMapWins = 0;
    let countRoundWins = 0;
    const uniqueWeeks = new Set();

    allScores.forEach((s) => {
      const gType = getGameType(s.challenges);
      if (gType !== "country_count") {
        [s.r1, s.r2, s.r3, s.r4, s.r5].forEach((r) => {
          if (r === 5000) count5k++;
        });
        if (s.total_score === 25000) count25k++;
      }
      if (s.challenges?.week_id) uniqueWeeks.add(s.challenges.week_id);

      const chRank = chRankingsMap.get(s.challenge_id)?.get(playerId);
      if (chRank) {
        if (chRank.isMapWin) countMapWins++;
        countRoundWins += chRank.roundWins || 0;
      }
    });

    weeksPlayedEl.textContent = uniqueWeeks.size;
    totalMapsEl.textContent = allScores.length;
    if (mapWinsEl) mapWinsEl.textContent = countMapWins.toLocaleString();
    if (roundWinsEl) roundWinsEl.textContent = countRoundWins.toLocaleString();
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
      return getMapNum(a.challenges) - getMapNum(b.challenges) || getSubSeedNum(a.challenges) - getSubSeedNum(b.challenges);
    });

    tbody.innerHTML = allScores
      .map((s) => {
        const ch = s.challenges || {};
        const wk = ch.weeks || {};
        const isCountry = getGameType(ch) === "country_count";
        const modeInfo = isCountry
          ? { label: "Country", cls: "other" }
          : detectMapMode(ch.name);
        const total = s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0));
        const statusTag = wk.is_frozen
          ? `<span style="font-size: 0.7rem; background: #e0f2fe; color: #0369a1; padding: 1px 4px; border-radius: 3px;">Frozen</span>`
          : `<span style="font-size: 0.7rem; background: #fef3c7; color: #b45309; padding: 1px 4px; border-radius: 3px;">Live</span>`;

        const chRank = chRankingsMap.get(s.challenge_id)?.get(playerId);
        const maxR = chRank?.maxRounds || [];

        const renderR = (val, idx) => {
          if (isCountry) {
            return Number(val) === 1
              ? `<strong style="color: #15803d;">✅ 1</strong>`
              : `<span style="color: #94a3b8;">❌ 0</span>`;
          }
          const isWin = maxR[idx] !== undefined && val === maxR[idx] && maxR[idx] > 0;
          if (isWin) {
            return `<strong style="color: #15803d;" title="Round ${idx + 1} Best Score!">★ ${(val ?? 0).toLocaleString()}</strong>`;
          }
          return (val ?? 0).toLocaleString();
        };

        const mapWinBadge = chRank?.isMapWin ? `<span style="margin-left: 4px;" title="อันดับ 1 ของแมพนี้!">🥇</span>` : "";
        const mNum = getMapNum(ch);
        const sNum = getSubSeedNum(ch);
        const seedSubText = sNum > 1 ? ` (S${sNum})` : "";

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="font-weight: 600; color: #475569;">
              ${escapeHtml(wk.title || `W${ch.week_id}`)} ${statusTag}
            </td>
            <td style="text-align: left; padding-left: 10px;">
              <strong>M${mNum}${seedSubText}:</strong> ${renderFlags(escapeHtml(ch.name || `Map ${mNum}`))} ${mapWinBadge}
            </td>
            <td><span class="mode-tag ${modeInfo.cls}">${modeInfo.label}</span></td>
            <td>${renderR(s.r1, 0)}</td>
            <td>${renderR(s.r2, 1)}</td>
            <td>${renderR(s.r3, 2)}</td>
            <td>${renderR(s.r4, 3)}</td>
            <td>${renderR(s.r5, 4)}</td>
            <td style="background: #eff6ff; font-weight: bold; color: #1e3a8a;">${isCountry ? `${total}/5` : total.toLocaleString()}</td>
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
let inspCalculatedSeeds = new Map(); // challengeId -> pList
let inspCalculatedMapGroups = new Map(); // mapNumber -> { mapNumber, name, gameType, seeds, leaderboard }
let inspSelectedMap = 1;
let inspSelectedSubSeed = 0; // 0 = Map Overview (multi-seed avg), 1..N = specific seed
let inspCurrentSubView = "map"; // "map" | "round"
let inspSelectedRound = 0; // 0..4 = R1..R5, 5 = Total (R6)

function getRankClass(rank) {
  if (rank === 1) return "rank-gold";
  if (rank === 2) return "rank-silver";
  if (rank === 3) return "rank-bronze";
  return "";
}

function formatPlayedTime(dateStr) {
  if (!dateStr) return '<span style="color: #94a3b8; font-size: 0.78rem;">-</span>';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '<span style="color: #94a3b8; font-size: 0.78rem;">-</span>';
  const datePart = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" });
  const timePart = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `<span title="${escapeHtml(d.toLocaleString("th-TH"))}" style="font-size: 0.75rem; color: #475569; font-weight: 600;">${datePart}, ${timePart}</span>`;
}

window.openMapInspectorModal = async function (weekId, weekTitle) {
  if (!adminDb) return;
  inspWeekId = weekId;
  const resolvedTitle = weekTitle || weeksById.get(weekId)?.title || `Week ${weekId}`;
  const modal = document.getElementById("mapInspectorModal");
  document.getElementById("inspectorModalSubtitle").textContent = `สัปดาห์: ${resolvedTitle}`;
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
    inspWeekChallenges = sortChallenges(challenges || []);

    const chIds = inspWeekChallenges.map((c) => c.id);
    const hasCountryMap = inspWeekChallenges.some((c) => getGameType(c) === "country_count");
    const inspCols = hasCountryMap
      ? "id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, played_at, round_details, players(id, username)"
      : "id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, played_at, players(id, username)";

    let { data: scores, error: scErr } =
      chIds.length === 0
        ? { data: [], error: null }
        : await fetchAllRows(() =>
            adminDb
              .from("scores")
              .select(inspCols)
              .in("challenge_id", chIds)
              .order("id", { ascending: true })
          );

    if (
      scErr &&
      (scErr.message?.includes("played_at") ||
        scErr.message?.includes("round_details") ||
        scErr.code === "PGRST204")
    ) {
      const fb = await fetchAllRows(() =>
        adminDb
          .from("scores")
          .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, players(id, username)")
          .in("challenge_id", chIds)
          .order("id", { ascending: true })
      );
      scores = fb.data;
      scErr = fb.error;
    }

    if (scErr) throw scErr;
    inspWeekScores = scores || [];

    computeInspectorCalculations();
    const firstMapNum = inspWeekChallenges[0] ? getMapNum(inspWeekChallenges[0]) : 1;
    inspSelectedMap = firstMapNum;
    const firstGroup = inspCalculatedMapGroups.get(firstMapNum);
    inspSelectedSubSeed = firstGroup && firstGroup.seeds.length > 1 ? 0 : 1;
    inspCurrentSubView = "map";
    inspSelectedRound = 0;

    renderMapInspector();
  } catch (err) {
    console.error("Load inspector data error:", err);
    document.getElementById("inspectorTableBody").innerHTML = `<tr><td colspan="10" style="padding: 24px; text-align: center; color: red;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function computeInspectorCalculations() {
  inspCalculatedSeeds.clear();
  inspCalculatedMapGroups.clear();

  inspWeekChallenges.forEach((c) => {
    const rawScores = inspWeekScores.filter((s) => s.challenge_id === c.id);
    const pList = rawScores.map((s) => ({
      scoreId: s.id,
      playerId: s.player_id,
      username: s.players?.username || `Player #${s.player_id}`,
      playedAt: s.played_at || null,
      raw: [
        s.r1 || 0,
        s.r2 || 0,
        s.r3 || 0,
        s.r4 || 0,
        s.r5 || 0,
        s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0)),
      ],
      phantoms: [],
      points: [],
      h2h: [],
    }));

    scoreSingleSeedList(pList, getGameType(c));
    inspCalculatedSeeds.set(c.id, pList);
  });

  // จัดกลุ่มเป็น 7 Maps เพื่อคำนวณค่าเฉลี่ย Multi-Seed (ถ้ามี > 1 Seed)
  const byMap = new Map();
  inspWeekChallenges.forEach((c) => {
    const m = getMapNum(c);
    if (!byMap.has(m)) byMap.set(m, []);
    byMap.get(m).push(c);
  });

  byMap.forEach((seeds, mapNum) => {
    const sortedSeeds = sortChallenges(seeds);
    const first = sortedSeeds[0];
    const seedCount = sortedSeeds.length;
    const gameType = getGameType(first);
    const playerAgg = new Map();

    sortedSeeds.forEach((ch) => {
      const sList = inspCalculatedSeeds.get(ch.id) || [];
      sList.forEach((p) => {
        if (!playerAgg.has(p.playerId)) {
          playerAgg.set(p.playerId, {
            playerId: p.playerId,
            username: p.username,
            seedData: {},
            sumPts: 0,
            sumRaw: 0,
          });
        }
        const agg = playerAgg.get(p.playerId);
        agg.seedData[ch.id] = p;
        agg.sumPts += p.ptsMap;
        agg.sumRaw += p.raw[5];
      });
    });

    const leaderboard = Array.from(playerAgg.values()).map((agg) => ({
      ...agg,
      ptsMap: seedCount === 1 ? agg.sumPts : Math.round((agg.sumPts / seedCount) * 10) / 10,
    }));

    leaderboard.sort((a, b) => b.ptsMap - a.ptsMap || b.sumRaw - a.sumRaw);
    leaderboard.forEach((p, idx) => {
      const isTie = idx > 0 && leaderboard[idx - 1].ptsMap === p.ptsMap;
      p.mapRank = isTie ? leaderboard[idx - 1].mapRank : idx + 1;
    });

    inspCalculatedMapGroups.set(mapNum, {
      mapNumber: mapNum,
      name: first.name || `Map ${mapNum}`,
      gameType,
      seeds: sortedSeeds,
      leaderboard,
    });
  });
}

window.selectInspectorMap = function (mapNum) {
  inspSelectedMap = mapNum;
  const grp = inspCalculatedMapGroups.get(mapNum);
  inspSelectedSubSeed = grp && grp.seeds.length > 1 ? 0 : 1;
  renderMapInspector();
};

window.selectInspectorSubSeed = function (subSeedNum) {
  inspSelectedSubSeed = subSeedNum;
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
  const mapEntries = Array.from(inspCalculatedMapGroups.values()).sort((a, b) => a.mapNumber - b.mapNumber);

  pillsContainer.innerHTML = mapEntries
    .map((grp) => {
      const isSel = grp.mapNumber === inspSelectedMap;
      const bgStyle = isSel
        ? "background: #0284c7; color: white; border-color: #0284c7;"
        : "background: white; color: #475569; border: 1px solid #cbd5e1;";
      const typeTag = grp.gameType === "country_count" ? " 🌍" : "";
      const seedTag = grp.seeds.length > 1 ? ` (${grp.seeds.length} Seeds)` : "";
      return `
        <button class="btn" style="${bgStyle} font-size: 0.8rem; padding: 5px 12px; border-radius: 20px;" onclick="selectInspectorMap(${grp.mapNumber})">
          🗺️ Map ${grp.mapNumber}${typeTag}: ${renderFlags(escapeHtml(grp.name))}${seedTag}
        </button>
      `;
    })
    .join("");

  const activeGroup = inspCalculatedMapGroups.get(inspSelectedMap) || mapEntries[0];
  if (!activeGroup) return;

  const seedPillsContainer = document.getElementById("inspectorSeedPills");
  if (seedPillsContainer) {
    if (activeGroup.seeds.length > 1) {
      seedPillsContainer.style.display = "flex";
      const avgBtnStyle =
        inspSelectedSubSeed === 0
          ? "background: #00247d; color: white;"
          : "background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1;";
      const seedBtns = activeGroup.seeds
        .map((s) => {
          const sNum = getSubSeedNum(s);
          const isSel = inspSelectedSubSeed === sNum;
          const st = isSel
            ? "background: #0d9488; color: white;"
            : "background: white; color: #475569; border: 1px solid #cbd5e1;";
          return `<button class="btn" style="${st} font-size: 0.78rem; padding: 4px 10px;" onclick="selectInspectorSubSeed(${sNum})">Seed ${sNum}</button>`;
        })
        .join("");

      seedPillsContainer.innerHTML = `
        <span style="font-size: 0.8rem; font-weight: bold; color: #64748b;">เลือกดู Seed:</span>
        <button class="btn" style="${avgBtnStyle} font-size: 0.78rem; padding: 4px 10px;" onclick="selectInspectorSubSeed(0)">
          📊 ภาพรวม Map (เฉลี่ย ÷ ${activeGroup.seeds.length})
        </button>
        ${seedBtns}
      `;
    } else {
      seedPillsContainer.style.display = "none";
      inspSelectedSubSeed = 1;
    }
  }

  const thead = document.getElementById("inspectorTableHead");
  const tbody = document.getElementById("inspectorTableBody");
  const btnMap = document.getElementById("inspBtnMapSummary");
  const btnRound = document.getElementById("inspBtnRoundDeep");
  const roundPillsContainer = document.getElementById("inspectorRoundPillsContainer");
  const footerNote = document.getElementById("inspectorFooterNote");
  const isCountry = activeGroup.gameType === "country_count";

  // โหมดภาพรวม Multi-Seed (เฉลี่ย ÷ N)
  if (activeGroup.seeds.length > 1 && inspSelectedSubSeed === 0) {
    btnMap.style.background = "var(--navy-primary)";
    btnMap.style.color = "white";
    btnRound.style.background = "#e2e8f0";
    btnRound.style.color = "#334155";
    roundPillsContainer.style.display = "none";
    if (footerNote) {
      footerNote.textContent = `* คะแนนประจำ Map คำนวณจาก (ผลรวมคะแนนทุก Seed) ÷ ${activeGroup.seeds.length} (หากไม่เล่น Seed ไหนจะได้ 0 ใน Seed นั้น)`;
    }

    const seedHeaders = activeGroup.seeds
      .map((s) => `<th style="text-align: center; min-width: 90px;">Seed ${getSubSeedNum(s)}</th>`)
      .join("");

    thead.innerHTML = `
      <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
        <th style="width: 50px; text-align: center; padding: 8px;">อันดับ</th>
        <th style="text-align: left; padding: 8px 12px; width: 170px;">ผู้เล่น (Pseudo)</th>
        ${seedHeaders}
        <th style="width: 110px; text-align: center; background: #00247d; color: white;">Map Points (÷${activeGroup.seeds.length})</th>
      </tr>
    `;

    if (activeGroup.leaderboard.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${3 + activeGroup.seeds.length}" style="padding: 30px; text-align: center; color: #94a3b8;">ยังไม่มีผู้เล่นในแมพนี้</td></tr>`;
      return;
    }

    tbody.innerHTML = activeGroup.leaderboard
      .map((p) => {
        const rankCls = getRankClass(p.mapRank);
        const seedCols = activeGroup.seeds
          .map((s) => {
            const sd = p.seedData[s.id];
            if (!sd) {
              return `<td style="text-align: center; color: #cbd5e1;">-</td>`;
            }
            const rawTxt = isCountry ? `${sd.raw[5]}/5 🌍` : sd.raw[5].toLocaleString();
            return `
              <td style="text-align: center; padding: 6px 4px;">
                <div style="font-weight: 700; color: #00247d;">${sd.ptsMap} pts</div>
                <div style="font-size: 0.72rem; color: #64748b;">(${rawTxt})</div>
              </td>
            `;
          })
          .join("");

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td class="col-pos ${rankCls}" style="text-align: center;">${p.mapRank}</td>
            <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${escapeHtml(p.username)}</td>
            ${seedCols}
            <td style="text-align: center; font-size: 1.05rem; font-weight: 800; color: #00247d; background: #f8fafc;">
              ${p.ptsMap}
            </td>
          </tr>
        `;
      })
      .join("");
    return;
  }

  // โหมดดูราย Seed (1 Seed หรือเลือกดูเฉพาะ Seed)
  const activeChallenge =
    activeGroup.seeds.find((s) => getSubSeedNum(s) === inspSelectedSubSeed) || activeGroup.seeds[0];
  if (!activeChallenge) return;

  const pList = inspCalculatedSeeds.get(activeChallenge.id) || [];

  if (footerNote) {
    footerNote.textContent = isCountry
      ? "* โหมด Country Count: ไม่มี Phantom Score — ถูกประเทศ (1) เทียบ H2H ปกติ, ผิดประเทศหรือได้ Total = 0 ตีตกเป็น 0 แต้มทันที"
      : "* คำนวณด้วยระบบ Head-to-Head Pairwise (Half-Tie: ชนะ 1 แต้ม, เสมอ 0.5 แต้ม, แพ้ 0 แต้ม) ปัดเศษ Map Points สุทธิ";
  }

  if (inspCurrentSubView === "map") {
    btnMap.style.background = "var(--navy-primary)";
    btnMap.style.color = "white";
    btnRound.style.background = "#e2e8f0";
    btnRound.style.color = "#334155";
    roundPillsContainer.style.display = "none";

    thead.innerHTML = `
      <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
        <th style="width: 50px; text-align: center; padding: 8px;">อันดับ</th>
        <th style="text-align: left; padding: 8px 12px; width: 160px;">ผู้เล่น (Pseudo)</th>
        <th style="width: 110px; text-align: center; color: #475569;">เวลาที่เล่น</th>
        <th style="width: 70px; text-align: center;">R1</th>
        <th style="width: 70px; text-align: center;">R2</th>
        <th style="width: 70px; text-align: center;">R3</th>
        <th style="width: 70px; text-align: center;">R4</th>
        <th style="width: 70px; text-align: center;">R5</th>
        <th style="width: 90px; text-align: center; background: #eff6ff; color: #1e3a8a;">${isCountry ? "Total (0-5)" : "Total 25k"}</th>
        <th style="width: 85px; text-align: center; background: #00247d; color: white;">Seed Points</th>
      </tr>
    `;

    if (pList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="padding: 30px; text-align: center; color: #94a3b8;">ยังไม่มีผู้เล่นใน Seed นี้</td></tr>`;
      return;
    }

    tbody.innerHTML = pList
      .map((p) => {
        const rankCls = getRankClass(p.mapRank);
        const roundCells = [0, 1, 2, 3, 4]
          .map((rIdx) => {
            const rawDisplay = isCountry
              ? p.raw[rIdx] === 1
                ? "✅ 1"
                : "❌ 0"
              : p.raw[rIdx].toLocaleString();
            return `
            <td style="text-align: center; padding: 6px 4px; border-bottom: 1px solid #e2e8f0;">
              <div style="font-weight: 600; color: #334155;">${rawDisplay}</div>
              <div style="font-size: 0.73rem; color: #16a34a; font-weight: 700;">+${p.points[rIdx]} pts</div>
            </td>
          `;
          })
          .join("");

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td class="col-pos ${rankCls}" style="text-align: center;">${p.mapRank}</td>
            <td style="padding: 6px 12px; font-weight: 600; color: #1e293b;">${escapeHtml(p.username)}</td>
            <td style="text-align: center; padding: 6px 4px;">${formatPlayedTime(p.playedAt)}</td>
            ${roundCells}
            <td style="text-align: center; padding: 6px 4px; background: #eff6ff;">
              <div style="font-weight: 700; color: #1e3a8a;">${isCountry ? `${p.raw[5]} / 5` : p.raw[5].toLocaleString()}</div>
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

    thead.innerHTML = `
      <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
        <th style="width: 50px; text-align: center; padding: 8px;">อันดับ</th>
        <th style="text-align: left; padding: 8px 12px; width: 160px;">ผู้เล่น (Pseudo)</th>
        <th style="width: 110px; text-align: center; color: #475569;">เวลาที่เล่น</th>
        <th style="width: 95px; text-align: center;">${isCountry ? "ผลทาย" : "คะแนนดิบ (Raw)"}</th>
        <th style="width: 105px; text-align: center; background: #eff6ff; color: #1e3a8a;">${isCountry ? "Phantom" : "Phantom (10%)"}</th>
        <th style="text-align: left; padding: 8px 12px;">ผลการเจอกับคู่แข่งอีก ${Math.max(0, pList.length - 1)} คน (H2H)</th>
        <th style="width: 95px; text-align: center; background: #00247d; color: white;">แต้มรอบนี้</th>
      </tr>
    `;

    if (pList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding: 30px; text-align: center; color: #94a3b8;">ยังไม่มีผู้เล่นใน Seed นี้</td></tr>`;
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
        const phantomVal = isCountry
          ? "ไม่มี (0%)"
          : p.phantoms[m] !== undefined
            ? p.phantoms[m].toFixed(1)
            : "-";
        const rawDisplay = isCountry
          ? m < 5
            ? p.raw[m] === 1
              ? "✅ ถูก (1)"
              : "❌ ผิด (0)"
            : `${p.raw[m]} / 5`
          : p.raw[m].toLocaleString();

        let outcomeBadge = "";
        if (h.zeroed) {
          outcomeBadge = `
            <span style="display: inline-block; background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">
              ได้ 0 → ตีตก 0 แต้มทันที
            </span>
          `;
        } else {
          outcomeBadge = `
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
        }

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td class="col-pos ${rankCls}" style="text-align: center;">${p.roundRank}</td>
            <td style="padding: 8px 12px; font-weight: 600; color: #1e293b;">${escapeHtml(p.username)}</td>
            <td style="text-align: center; padding: 6px 4px;">${formatPlayedTime(p.playedAt)}</td>
            <td style="text-align: center; font-weight: 700; color: #0f172a;">${rawDisplay}</td>
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
