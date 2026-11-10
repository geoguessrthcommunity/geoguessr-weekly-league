// ====================================================================
// ตัวรัน Sync วนลูปทุก 30 นาทีบนเครื่องคอมพิวเตอร์ของคุณ
// ไม่ต้องใช้ GitHub ใด ๆ ทั้งสิ้น ดับเบิ้ลคลิกไฟล์ start-sync.bat แล้วเปิดทิ้งไว้ได้เลย
// ====================================================================

require("dotenv").config();
const { execSync } = require("child_process");

const INTERVAL_MINUTES = 30;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function runSync() {
  console.log(`\n==================================================`);
  console.log(`⏰ [${new Date().toLocaleTimeString()}] เริ่มการ Sync คะแนน...`);
  console.log(`==================================================`);

  try {
    execSync("node sync.js", { stdio: "inherit" });
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดระหว่างรัน sync.js");
  }

  console.log(`\n💤 รออีก ${INTERVAL_MINUTES} นาที สำหรับรอบถัดไป... (กด Ctrl+C เพื่อหยุด)`);
}

// รันรอบแรกทันทีที่เปิด
runSync();

// วนลูปทำงานทุก ๆ 30 นาที
setInterval(runSync, INTERVAL_MS);

