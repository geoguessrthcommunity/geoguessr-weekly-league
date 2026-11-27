// ====================================================================
// Offline Country Lookup Module (Natural Earth 10m + Spatial Index)
// ใช้แปลงพิกัด (lat, lng) เป็นรหัสประเทศ ISO 3166-1 alpha-2 แบบออฟไลน์
// ความละเอียดสูงระดับ 1:10m พร้อม RBush R-Tree และ Microstate/Coastal Handling
// ====================================================================

const fs = require("fs");
const topojson = require("topojson-client");
const pipMod = require("@turf/boolean-point-in-polygon");
const bboxMod = require("@turf/bbox");
const rbushMod = require("rbush");

const booleanPointInPolygon = pipMod.default || pipMod.booleanPointInPolygon;
const computeBbox = bboxMod.default || bboxMod.bbox;
const RBush = rbushMod.default || rbushMod;

let initialized = false;
let initPromise = null;
let geoFeatures = [];
let spatialTree = null;
let countryCoder = null;

// รหัสเฉพาะสำหรับ feature ใน Natural Earth 10m ที่ไม่มี numeric ISO id
const UNMAPPED_FEATURE_NAMES = {
  Kosovo: "XK",
  "N. Cyprus": "CY",
  "Cyprus U.N. Buffer Zone": "CY",
  Somaliland: "SO",
  Baikonur: "KZ",
  Akrotiri: "GB",
  Dhekelia: "GB",
  "USNB Guantanamo Bay": "CU",
};

// Microstates ที่อาจถูกบีบอัดใน TopoJSON 10m หรือซ้อนทับกับประเทศล้อมรอบ
const MICROSTATE_CODES = new Set(["VA", "MC", "SM", "LI", "AD", "GI", "SG", "MT"]);

function resolveFeatureIsoCode(feature) {
  if (!feature) return null;
  if (feature.id && countryCoder) {
    const padded = String(feature.id).padStart(3, "0");
    const iso = countryCoder.iso1A2Code(padded);
    if (iso) return iso.toUpperCase();
  }
  const name = feature.properties?.name || "";
  if (UNMAPPED_FEATURE_NAMES[name]) {
    return UNMAPPED_FEATURE_NAMES[name];
  }
  return null;
}

async function initCountryLookup() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    countryCoder = await import("@rapideditor/country-coder");

    const atlasPath = require.resolve("world-atlas/countries-10m.json");
    const world = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
    const geo = topojson.feature(world, world.objects.countries);

    geoFeatures = geo.features || [];
    spatialTree = new RBush();

    const items = [];
    geoFeatures.forEach((f, idx) => {
      if (!f.geometry) return;
      const b = computeBbox(f);
      const area = Math.max(0, (b[2] - b[0]) * (b[3] - b[1]));
      items.push({
        minX: b[0],
        minY: b[1],
        maxX: b[2],
        maxY: b[3],
        idx,
        area,
      });
    });

    spatialTree.load(items);
    initialized = true;
  })();

  return initPromise;
}

function exactLookup10m(lng, lat) {
  if (!spatialTree) return null;
  const candidates = spatialTree
    .search({ minX: lng, minY: lat, maxX: lng, maxY: lat })
    .sort((a, b) => a.area - b.area);

  if (candidates.length === 0) return null;

  const pt = { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] } };
  for (const c of candidates) {
    const f = geoFeatures[c.idx];
    if (booleanPointInPolygon(pt, f)) {
      const code = resolveFeatureIsoCode(f);
      if (code) return code;
    }
  }
  return null;
}

/**
 * แปลงพิกัด (lat, lng) เป็นรหัสประเทศ ISO 3166-1 alpha-2 (เช่น "TH", "US", "HK", "VA")
 * คืนค่า null หากอยู่นอกแผ่นดิน (เช่น กลางทะเล) หรือพิกัดไม่ถูกต้อง
 */
async function lookupCountryCode(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  await initCountryLookup();

  // 1. ตรวจสอบด้วย Natural Earth 10m ก่อน (แม่นยำตามแนวชายฝั่งและพรมแดน ไม่หลุดลงทะเล)
  let code = exactLookup10m(lng, lat);

  // 2. ตรวจสอบ Microstate (เช่น Vatican, Monaco, Singapore) ที่อาจถูกซ้อนทับในประเทศล้อมรอบ
  if (
    countryCoder &&
    (!code || code === "IT" || code === "FR" || code === "ES" || code === "CH" || code === "AT" || code === "MY")
  ) {
    const micro = countryCoder.iso1A2Code([lng, lat], { level: "territory" });
    if (micro && MICROSTATE_CODES.has(micro.toUpperCase())) {
      return micro.toUpperCase();
    }
  }

  if (code) return code;

  // 3. Coastal Snap: เผื่อพิกัดริมชายฝั่ง/ท่าเรือ/ฟยอร์ดที่คลาดเคลื่อนจากเส้นชายฝั่ง 10m เล็กน้อย (~1-2.5 กม.)
  for (const radius of [0.01, 0.025]) {
    for (let i = 0; i < 8; i++) {
      const rad = (i * Math.PI) / 4;
      const snapped = exactLookup10m(lng + Math.cos(rad) * radius, lat + Math.sin(rad) * radius);
      if (snapped) return snapped;
    }
  }

  return null;
}

/**
 * ตรวจสอบว่ารอบนั้นผู้เล่นทายถูกประเทศหรือไม่
 * @param {object} roundObj - ข้อมูล round จาก GeoGuessr API (game.rounds[i])
 * @param {object} guessObj - ข้อมูล guess จาก GeoGuessr API (game.player.guesses[i])
 * @returns {Promise<{ ok: boolean, targetCode: string|null, guessCode: string|null }>}
 */
async function checkRoundCountryMatch(roundObj, guessObj) {
  let targetCode = null;
  if (roundObj && typeof roundObj.lat === "number" && typeof roundObj.lng === "number") {
    targetCode = await lookupCountryCode(roundObj.lat, roundObj.lng);
  }
  if (!targetCode && roundObj?.streakLocationCode) {
    targetCode = String(roundObj.streakLocationCode).trim().toUpperCase() || null;
  }

  // กรณีไม่ได้กดปักหมุด / หมดเวลา / ข้ามรอบ
  if (
    !guessObj ||
    guessObj.skippedRound ||
    typeof guessObj.lat !== "number" ||
    typeof guessObj.lng !== "number" ||
    (guessObj.timedOut && guessObj.lat === 0 && guessObj.lng === 0)
  ) {
    return { ok: false, targetCode, guessCode: null };
  }

  const guessCode = await lookupCountryCode(guessObj.lat, guessObj.lng);

  // ถ้ารหัสจาก GeoJSON ตรงกันถือว่าถูกทันที
  if (targetCode && guessCode && targetCode === guessCode) {
    return { ok: true, targetCode, guessCode };
  }

  // กรณีพิเศษ: ถ้า GeoGuessr ส่ง streakLocationCode มาด้วย และตรงกับ guessCode พอดี (เช่น ดินแดนย่อยบางจุด)
  const apiTarget = roundObj?.streakLocationCode
    ? String(roundObj.streakLocationCode).trim().toUpperCase()
    : null;
  if (apiTarget && guessCode && apiTarget === guessCode) {
    return { ok: true, targetCode: apiTarget, guessCode };
  }

  return { ok: false, targetCode, guessCode };
}

module.exports = {
  initCountryLookup,
  lookupCountryCode,
  checkRoundCountryMatch,
};
