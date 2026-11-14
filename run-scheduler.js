// ====================================================================
// ตัวรัน Sync วนลูปทุก 30 นาทีบนเครื่องคอมพิวเตอร์ของคุณ
// ไม่ต้องใช้ GitHub ใด ๆ ทั้งสิ้น ดับเบิ้ลคลิกไฟล์ start-sync.bat แล้วเปิดทิ้งไว้ได้เลย
// ====================================================================

require("dotenv").config();
const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const INTERVAL_MINUTES = 30;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let isSyncing = false;
let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  } catch (e) {}
}

function runSync() {
  if (isSyncing) return;
  isSyncing = true;

  console.log(`\n==================================================`);
  console.log(`⏰ [${new Date().toLocaleTimeString()}] เริ่มการ Sync คะแนนตามรอบ...`);
  console.log(`==================================================`);

  try {
    execSync("node sync.js", { stdio: "inherit" });
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดระหว่างรัน sync.js");
  } finally {
    isSyncing = false;
  }

  console.log(`\n💤 รออีก ${INTERVAL_MINUTES} นาที สำหรับรอบถัดไป... (หรือคลิกสั่ง Force Sync จากหน้าแอดมินได้ตลอดเวลา)`);
}

// ตรวจสอบคำสั่ง Force Sync จากหน้าแอดมินทุก 5 วินาที
async function checkForceSyncRequests() {
  if (!supabase || isSyncing) return;

  try {
    const { data: requests, error } = await supabase
      .from("sync_requests")
      .select("*")
      .eq("status", "pending")
      .order("id", { ascending: true })
      .limit(1);

    if (error || !requests || requests.length === 0) return;

    const req = requests[0];
    console.log(`\n⚡ ตรวจพบคำสั่ง "Force Sync ทันที" จากแอดมิน (Request #${req.id})!`);
    await supabase.from("sync_requests").update({ status: "processing" }).eq("id", req.id);

    isSyncing = true;
    try {
      execSync("node sync.js", { stdio: "inherit" });
      await supabase
        .from("sync_requests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", req.id);
      console.log(`✅ ดำเนินการ Force Sync #${req.id} เสร็จสิ้น!`);
    } catch (syncErr) {
      console.error(`❌ เกิดข้อผิดพลาดขณะรัน Force Sync #${req.id}:`, syncErr.message);
      await supabase
        .from("sync_requests")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", req.id);
    } finally {
      isSyncing = false;
    }
  } catch (err) {}
}

// รันรอบแรกทันทีที่เปิด
runSync();

// วนลูปทำงานทุก ๆ 30 นาที
setInterval(runSync, INTERVAL_MS);

// วนลูปตรวจเช็ก Force Sync ทุก 5 วินาที
if (supabase) {
  setInterval(checkForceSyncRequests, 5000);
}


