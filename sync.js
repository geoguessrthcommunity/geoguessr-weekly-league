// ====================================================================
// GeoGuessr Weekly Challenge Sync Worker (Node.js)
// ดึงคะแนนจาก GeoGuessr API และบันทึกลง Supabase
// รันอัตโนมัติผ่าน GitHub Actions หรือ Cron ทุก 30 นาที
// ====================================================================

require("dotenv").config();

// Polyfill WebSocket สำหรับ Node.js ทุกเวอร์ชันเพื่อป้องกัน Supabase Crash
if (typeof globalThis.WebSocket === "undefined") {
  try {
    globalThis.WebSocket = require("ws");
  } catch (e) {}
}

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEOGUESSR_COOKIE = process.env.GEOGUESSR_COOKIE; // ค่าคุกกี้ _ncfa
const BOT_USER_ID = process.env.BOT_USER_ID || ""; // ไอดีบัญชีบอทเพื่อกรองออก (ถ้ามี)

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ ขาด SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน Environment Variables");
  process.exit(1);
}

if (!GEOGUESSR_COOKIE) {
  console.error("❌ ขาด GEOGUESSR_COOKIE ใน Environment Variables");
  process.exit(1);
}

// สร้าง Supabase Client ด้วย Service Role Key เพื่อให้มีสิทธิ์เขียนข้อมูล
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ดึงผลลัพธ์ Challenge ทั้งหมดจาก GeoGuessr API (พร้อมรองรับ Pagination)
 */
async function fetchChallengeResults(token) {
  const players = [];
  let pagination = "";
  let page = 0;
  const maxPages = 40; // สูงสุด 2,000 คนต่อ Challenge

  // จัดรูปแบบ Cookie
  const cookieHeader = GEOGUESSR_COOKIE.includes("=")
    ? GEOGUESSR_COOKIE
    : `_ncfa=${GEOGUESSR_COOKIE}`;

  while (page < maxPages) {
    if (page > 0) await sleep(100); // หน่วงเวลา 100ms ป้องกัน Rate Limit

    const url =
      `https://www.geoguessr.com/api/v3/results/highscores/${encodeURIComponent(token)}?friends=false&limit=50&minRounds=5` +
      (pagination ? `&paginationToken=${encodeURIComponent(pagination)}` : "");

    try {
      const resp = await fetch(url, {
        headers: {
          Cookie: cookieHeader,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!resp.ok) {
        console.warn(`⚠️ ดึง token ${token} ไม่สำเร็จ (HTTP ${resp.status})`);
        break;
      }

      const data = await resp.json();
      const items = Array.isArray(data?.items) ? data.items : [];

      for (const item of items) {
        const userId = String(item.userId || item.game?.player?.id || "").trim();
        const username = String(item.playerName || item.game?.player?.nick || "Anonymous").trim();

        // 1. กรอง Guest ที่ไม่มี ID ออก
        if (!userId) continue;

        // 2. กรองบัญชีบอทออก (ถ้าตั้งไว้)
        if (BOT_USER_ID && userId === BOT_USER_ID) continue;

        const guesses = Array.isArray(item.game?.player?.guesses) ? item.game.player.guesses : [];

        // 3. กรองเฉพาะคนที่เล่นครบ 5 รอบเท่านั้น
        if (guesses.length < 5) continue;

        const r1 = Number(guesses[0]?.roundScoreInPoints) || 0;
        const r2 = Number(guesses[1]?.roundScoreInPoints) || 0;
        const r3 = Number(guesses[2]?.roundScoreInPoints) || 0;
        const r4 = Number(guesses[3]?.roundScoreInPoints) || 0;
        const r5 = Number(guesses[4]?.roundScoreInPoints) || 0;
        const total = Number(item.totalScore ?? (r1 + r2 + r3 + r4 + r5)) || 0;

        players.push({
          userId,
          username,
          r1,
          r2,
          r3,
          r4,
          r5,
          total,
        });
      }

      pagination = data?.paginationToken || "";
      if (!pagination || !items.length) break;
      page++;
    } catch (err) {
      console.error(`❌ เกิดข้อผิดพลาดขณะดึง Challenge ${token}:`, err.message);
      break;
    }
  }

  return players;
}

/**
 * ฟังก์ชันหลักในการซิงค์ข้อมูล
 */
async function main() {
  console.log("🚀 เริ่มต้นกระบวนการ Sync คะแนน GeoGuessr Weekly Challenge...");

  // 1. ดึงสัปดาห์ที่ยังไม่ Freeze (is_frozen = false)
  const { data: activeWeeks, error: weekError } = await supabase
    .from("weeks")
    .select("*")
    .eq("is_frozen", false);

  if (weekError) {
    console.error("❌ ไม่สามารถดึงข้อมูลสัปดาห์จาก Supabase:", weekError.message);
    process.exit(1);
  }

  if (!activeWeeks || activeWeeks.length === 0) {
    console.log("ℹ️ ไม่มีสัปดาห์ที่กำลังแข่งขันอยู่ (ทุกสัปดาห์ Freeze หมดแล้ว)");
    return;
  }

  const now = new Date();

  for (const week of activeWeeks) {
    console.log(`\n📌 กำลังตรวจสอบสัปดาห์: ${week.title} (ID: ${week.id})`);

    // ตรวจสอบว่าถึงเวลาตัดรอบอัตโนมัติหรือยัง
    const shouldFreeze = week.end_date && now >= new Date(week.end_date);

    // ดึง Challenges ทั้งหมดของสัปดาห์นี้
    const { data: challenges, error: chError } = await supabase
      .from("challenges")
      .select("*")
      .eq("week_id", week.id)
      .order("seed_number", { ascending: true });

    if (chError || !challenges || challenges.length === 0) {
      console.log(`⚠️ ไม่พบ Challenges ใน ${week.title}`);
      if (shouldFreeze) {
        await supabase.from("weeks").update({ is_frozen: true }).eq("id", week.id);
        console.log(`❄️ ทำการ Freeze สัปดาห์ ${week.title} เรียบร้อย`);
      }
      continue;
    }

    console.log(`🔍 พบทั้งหมด ${challenges.length} seeds สำหรับ ${week.title}`);

    for (const challenge of challenges) {
      console.log(`  -> กำลังดึง Seed ${challenge.seed_number} (Token: ${challenge.token})...`);
      const results = await fetchChallengeResults(challenge.token);
      console.log(`     ได้ข้อมูลผู้เล่นครบ 5 รอบ: ${results.length} คน`);

      if (results.length === 0) continue;

      // 1. บันทึก / อัปเดตข้อมูลผู้เล่นลงตาราง players
      const playerUpserts = results.map((r) => ({
        id: r.userId,
        username: r.username,
        updated_at: new Date().toISOString(),
      }));

      const { error: pErr } = await supabase
        .from("players")
        .upsert(playerUpserts, { onConflict: "id" });

      if (pErr) console.warn("     ⚠️ เตือน: อัปเดตตาราง players ไม่สำเร็จ:", pErr.message);

      // 2. บันทึก / อัปเดตคะแนนลงตาราง scores
      const scoreUpserts = results.map((r) => ({
        challenge_id: challenge.id,
        player_id: r.userId,
        r1: r.r1,
        r2: r.r2,
        r3: r.r3,
        r4: r.r4,
        r5: r.r5,
        total_score: r.total,
        updated_at: new Date().toISOString(),
      }));

      const { error: sErr } = await supabase
        .from("scores")
        .upsert(scoreUpserts, { onConflict: "challenge_id,player_id" });

      if (sErr) console.warn("     ⚠️ เตือน: อัปเดตตาราง scores ไม่สำเร็จ:", sErr.message);
    }

    // อัปเดตเวลา Last Update ของสัปดาห์นี้
    await supabase
      .from("weeks")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", week.id);

    // หากถึงเวลาตัดรอบ ให้ Freeze สัปดาห์นี้ทันทีหลังจาก Sync รอบสุดท้ายเสร็จ
    if (shouldFreeze) {
      await supabase.from("weeks").update({ is_frozen: true }).eq("id", week.id);
      console.log(`❄️ ถึงเวลาตัดรอบแล้ว: ทำการ Freeze สัปดาห์ "${week.title}" สำเร็จ!`);
    }
  }

  console.log("\n✅ สิ้นสุดกระบวนการ Sync คะแนนเรียบร้อยแล้ว!");
}

main().catch((err) => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});

