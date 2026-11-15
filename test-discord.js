// ====================================================================
// Discord Notification Tester
// ใช้สำหรับทดสอบการส่งข้อความแจ้งเตือนไปยังห้อง Discord แอดมิน
// รันคำสั่ง: node test-discord.js
// ====================================================================

require("dotenv").config();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ADMIN_CHANNEL_ID = process.env.DISCORD_ADMIN_CHANNEL_ID;

async function runTest() {
  console.log("🧪 กำลังตรวจสอบการตั้งค่า Discord...");

  const isBot = DISCORD_BOT_TOKEN && DISCORD_ADMIN_CHANNEL_ID;
  const isWebhook = !!DISCORD_WEBHOOK_URL;

  if (!isBot && !isWebhook) {
    console.error("❌ ไม่พบการตั้งค่า Discord ใน .env");
    console.log("\nกรุณาตั้งค่าอย่างใดอย่างหนึ่งในไฟล์ .env:");
    console.log("  วิธีที่ 1 (Webhook URL):");
    console.log("    DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...\n");
    console.log("  วิธีที่ 2 (Bot Token + Channel ID):");
    console.log("    DISCORD_BOT_TOKEN=your-bot-token");
    console.log("    DISCORD_ADMIN_CHANNEL_ID=your-channel-id\n");
    process.exit(1);
  }

  let targetUrl;
  const headers = { "Content-Type": "application/json" };

  if (isBot) {
    console.log(`🤖 โหมด: Discord Bot API (Channel ID: ${DISCORD_ADMIN_CHANNEL_ID})`);
    targetUrl = `https://discord.com/api/v10/channels/${DISCORD_ADMIN_CHANNEL_ID}/messages`;
    headers["Authorization"] = `Bot ${DISCORD_BOT_TOKEN.replace(/^Bot\s+/i, "")}`;
  } else {
    console.log(`🔗 โหมด: Discord Webhook URL`);
    targetUrl = DISCORD_WEBHOOK_URL;
  }

  const samplePayload = {
    embeds: [
      {
        title: "✅ ทดสอบการเชื่อมต่อระบบแจ้งเตือนสำเร็จ! (Discord Alert Test)",
        description:
          "ระบบแจ้งเตือนแอดมินสำหรับ **GeoGuessr Weekly Challenge League** เชื่อมต่อเรียบร้อยแล้ว!\nต่อไปนี้เมื่อมีคะแนนใหม่ หรือคะแนนระดับ 25k เข้ามา ระบบจะแจ้งเตือนมายังห้องนี้อัตโนมัติ 24 ชม.",
        color: 0x2ecc71,
        fields: [
          { name: "📡 โหมดการส่ง", value: isBot ? "Discord Bot Token" : "Discord Webhook", inline: true },
          { name: "⚡ สถานะ", value: "พร้อมทำงาน (Active)", inline: true },
          {
            name: "ตัวอย่างการแจ้งเตือนคะแนน",
            value:
              "• ผู้เล่น: **TestUser**\n• ด่าน: **Seed 1: Germany (Move 3')**\n• คะแนนรวม: **24,850** / 25,000\n• แต่ละรอบ: `5,000` • `4,950` • `4,900` • `5,000` • `5,000`\n• เวลาที่ใช้: `⚡ 5:42`",
            inline: false,
          },
        ],
        footer: { text: "GeoGuessr Weekly League • Notification System" },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(samplePayload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`❌ Discord API ส่งสถานะข้อผิดพลาด HTTP ${resp.status}:`);
      console.error(errText);
      if (resp.status === 401) {
        console.error("💡 คำแนะนำ: ตรวจสอบว่า DISCORD_BOT_TOKEN ถูกต้องหรือไม่");
      } else if (resp.status === 403) {
        console.error("💡 คำแนะนำ: บอทอาจยังไม่ได้สิทธิ์ 'Send Messages' หรือ 'Embed Links' ในห้องนี้");
      } else if (resp.status === 404) {
        console.error("💡 คำแนะนำ: ตรวจสอบว่า CHANNEL_ID หรือ WEBHOOK_URL ถูกต้องหรือไม่ และบอทอยู่ในเซิร์ฟเวอร์นั้นแล้วหรือยัง");
      }
      process.exit(1);
    }

    console.log("🎉 ยอดเยี่ยม! ส่งข้อความทดสอบไปยังห้อง Discord เรียบร้อยแล้ว!");
    console.log("👉 ตรวจสอบข้อความแจ้งเตือนในการ์ด Embed ที่ห้อง Discord ของคุณได้เลย");
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดขณะส่งข้อความ:", err.message);
  }
}

runTest();
