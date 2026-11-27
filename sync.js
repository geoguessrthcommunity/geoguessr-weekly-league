// ====================================================================
// GeoGuessr Weekly Challenge Sync Worker (Node.js)
// ดึงคะแนนจาก GeoGuessr API และบันทึกลง Supabase
// พร้อมระบบ Discord Notifications สำหรับแจ้งเตือนแอดมินอัตโนมัติ
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
const { checkRoundCountryMatch } = require("./country-lookup");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEOGUESSR_COOKIE = process.env.GEOGUESSR_COOKIE; // ค่าคุกกี้ _ncfa
const BOT_USER_ID = process.env.BOT_USER_ID || ""; // ไอดีบัญชีบอทเพื่อกรองออก (ถ้ามี)

// Discord Notification Configurations (รองรับทั้ง Webhook URL และ Bot Token + Channel ID)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ADMIN_CHANNEL_ID = process.env.DISCORD_ADMIN_CHANNEL_ID;

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

let hasNotifiedCookieError = false;

// ====================================================================
// Discord Notification Helpers
// ====================================================================

/**
 * ส่งข้อความหรือ Embed ไปยัง Discord ผ่าน REST API (Bot Token) หรือ Webhook URL
 */
async function sendDiscordMessage(payload) {
  const isBot = DISCORD_BOT_TOKEN && DISCORD_ADMIN_CHANNEL_ID;
  const isWebhook = !!DISCORD_WEBHOOK_URL;

  if (!isBot && !isWebhook) {
    return false;
  }

  try {
    let targetUrl;
    const headers = { "Content-Type": "application/json" };

    if (isBot) {
      targetUrl = `https://discord.com/api/v10/channels/${DISCORD_ADMIN_CHANNEL_ID}/messages`;
      headers["Authorization"] = `Bot ${DISCORD_BOT_TOKEN.replace(/^Bot\s+/i, "")}`;
    } else {
      targetUrl = DISCORD_WEBHOOK_URL;
    }

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`⚠️ ส่ง Discord ไม่สำเร็จ (HTTP ${resp.status}):`, errText);
      return false;
    }

    return true;
  } catch (err) {
    console.warn("⚠️ เกิดข้อผิดพลาดขณะส่ง Discord notification:", err.message);
    return false;
  }
}

/**
 * ส่ง Embeds ไปยัง Discord (แบ่งเป็นชุดสูงสุด 10 embeds ต่อ 1 message ตามข้อกำหนดของ Discord)
 */
async function sendDiscordEmbeds(embeds) {
  if (!embeds || embeds.length === 0) return;
  for (let i = 0; i < embeds.length; i += 10) {
    const chunk = embeds.slice(i, i + 10);
    await sendDiscordMessage({ embeds: chunk });
    if (i + 10 < embeds.length) await sleep(1000);
  }
}

/**
 * จัดรูปแบบระยะเวลาเล่น (วินาที -> มม:วว)
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * จัดรูปแบบเวลาเป็นภาษาไทย โซนเวลา Asia/Bangkok
 */
function formatBangkokTime(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return isoString;
  }
}

function getChallengeLabel(challenge) {
  const mapNum = challenge.map_number || challenge.seed_number;
  const subSeed = challenge.sub_seed_number || 1;
  const mapName = challenge.name || `Map ${mapNum}`;
  const seedSuffix = challenge.hasMultiSeed || subSeed > 1 ? ` (Seed ${subSeed})` : "";
  const typeTag = challenge.game_type === "country_count" ? " [Country Count]" : "";
  return `Map ${mapNum}${seedSuffix}: ${mapName}${typeTag}`;
}

/**
 * สร้าง Embed แจ้งเตือนคะแนนรายบุคคล (รองรับคะแนนใหม่, อัปเดต, และ Perfect Score ทั้งโหมดปกติและ Country Count)
 */
function createScoreEmbed(challenge, week, player, isUpdate = false, oldScore = null) {
  const isCountryCount = challenge.game_type === "country_count";
  const isPerfect = isCountryCount ? Number(player.total) === 5 : Number(player.total) === 25000;
  const mapTitle = getChallengeLabel(challenge);
  const modeText = challenge.game_mode ? ` (${challenge.game_mode})` : "";
  const challengeUrl = `https://www.geoguessr.com/challenge/${challenge.token}`;

  let title, color;
  if (isPerfect) {
    title = isCountryCount
      ? `🌟 PERFECT! ถูกครบทั้ง 5 ประเทศ!`
      : `🌟 PERFECT SCORE! 25,000 แต้มเต็ม!`;
    color = 0xF1C40F; // Gold
  } else if (isUpdate) {
    title = `🔄 มีการอัปเดตคะแนน`;
    color = 0xE67E22; // Orange
  } else {
    title = `🎮 คะแนนใหม่เข้ามา!`;
    color = 0x2ECC71; // Emerald Green
  }

  let scoreText;
  let roundsText;
  if (isCountryCount) {
    scoreText =
      isUpdate && oldScore !== null
        ? `**${Number(player.total)}** / 5 ประเทศ (เดิม ${Number(oldScore)})`
        : `**${Number(player.total)}** / 5 ประเทศ`;
    const rArr = [player.r1, player.r2, player.r3, player.r4, player.r5];
    roundsText = rArr
      .map((val, idx) => {
        const icon = Number(val) === 1 ? "✅" : "❌";
        const detail = Array.isArray(player.roundDetails) ? player.roundDetails[idx] : null;
        if (detail?.target) {
          const guessTxt = detail.guess && !detail.ok ? `→${detail.guess}` : "";
          return `${icon} \`${detail.target}${guessTxt}\``;
        }
        return icon;
      })
      .join(" • ");
  } else {
    scoreText =
      isUpdate && oldScore !== null
        ? `**${Number(player.total).toLocaleString()}** / 25,000 (เดิม ${Number(oldScore).toLocaleString()})`
        : `**${Number(player.total).toLocaleString()}** / 25,000`;
    roundsText = `\`${Number(player.r1).toLocaleString()}\` • \`${Number(player.r2).toLocaleString()}\` • \`${Number(player.r3).toLocaleString()}\` • \`${Number(player.r4).toLocaleString()}\` • \`${Number(player.r5).toLocaleString()}\``;
  }

  const fields = [
    { name: "👤 ผู้เล่น", value: `**${player.username}**`, inline: true },
    { name: isCountryCount ? "🌍 ทายถูก" : "⭐ คะแนนรวม", value: scoreText, inline: true },
    {
      name: "⏱️ เวลาที่ใช้",
      value: player.totalTime ? `⚡ ${formatDuration(player.totalTime)}` : "-",
      inline: true,
    },
    {
      name: "📊 แต่ละรอบ (R1 - R5)",
      value: roundsText,
      inline: false,
    },
    { name: "🕒 เวลาที่เล่น", value: formatBangkokTime(player.playedAt), inline: true },
    { name: "🔗 Challenge", value: `[เปิดเล่นด่านนี้](${challengeUrl})`, inline: true },
  ];

  return {
    title: `${title} — ${mapTitle}${modeText}`,
    url: challengeUrl,
    color,
    fields,
    footer: {
      text: `GeoGuessr Weekly Challenge • ${week.title}`,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * สร้าง Embed สรุปกรณีมีผู้เล่นใหม่เข้ามาหลายคนพร้อมกันใน Seed เดียว
 */
function createBatchNewScoresEmbed(challenge, week, players) {
  const isCountryCount = challenge.game_type === "country_count";
  const mapTitle = getChallengeLabel(challenge);
  const modeText = challenge.game_mode ? ` (${challenge.game_mode})` : "";
  const challengeUrl = `https://www.geoguessr.com/challenge/${challenge.token}`;

  const playerLines = players
    .map((p) => {
      const timeStr = p.totalTime ? ` • ⏱️ ${formatDuration(p.totalTime)}` : "";
      const scoreUnit = isCountryCount ? `${Number(p.total)}/5 ประเทศ` : `${Number(p.total).toLocaleString()} pts`;
      return `• **${p.username}**: \`${scoreUnit}\`${timeStr}`;
    })
    .join("\n");

  return {
    title: `🎮 มีผู้เล่นใหม่ ${players.length} คนใน ${mapTitle}${modeText}`,
    url: challengeUrl,
    color: 0x3498DB, // Blue
    description: playerLines.length > 3900 ? playerLines.substring(0, 3900) + "\n..." : playerLines,
    fields: [
      { name: "🔗 Challenge", value: `[เปิดเล่นด่านนี้](${challengeUrl})`, inline: true },
    ],
    footer: {
      text: `GeoGuessr Weekly Challenge • ${week.title}`,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * สร้าง Embed สรุปการซิงค์รอบแรกกรณีนำเข้า Seed ที่มีคนเล่นอยู่แล้วจำนวนมาก
 */
function createInitialImportEmbed(challenge, week, totalPlayers) {
  const mapTitle = getChallengeLabel(challenge);
  const modeText = challenge.game_mode ? ` (${challenge.game_mode})` : "";
  const challengeUrl = `https://www.geoguessr.com/challenge/${challenge.token}`;

  return {
    title: `📥 นำเข้าผลคะแนนเริ่มต้น ${mapTitle}${modeText}`,
    url: challengeUrl,
    color: 0x34495E, // Slate
    description: `ระบบได้ทำการเชื่อมต่อและดึงคะแนนเริ่มต้นของผู้เล่นเรียบร้อยแล้ว (**${totalPlayers} คน**)`,
    fields: [
      { name: "🔗 Challenge", value: `[เปิดเล่นด่านนี้](${challengeUrl})`, inline: true },
    ],
    footer: {
      text: `GeoGuessr Weekly Challenge • ${week.title}`,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * ส่งการแจ้งเตือนผลการเปลี่ยนแปลงคะแนนไปยัง Discord
 */
async function notifyScoreChanges(challenge, week, newPlayers, updatedPlayers, isInitialImport) {
  const isDiscordConfigured =
    DISCORD_WEBHOOK_URL || (DISCORD_BOT_TOKEN && DISCORD_ADMIN_CHANNEL_ID);

  if (!isDiscordConfigured) return;
  if (newPlayers.length === 0 && updatedPlayers.length === 0) return;

  const isCountryCount = challenge.game_type === "country_count";
  const embeds = [];

  // แยกคะแนนเต็ม (25,000 หรือ 5/5) เพื่อสร้างการ์ดทองเด่นพิเศษเสมอ
  const perfectPlayers = [];
  const normalNew = [];

  for (const p of newPlayers) {
    const isPerfect = isCountryCount ? Number(p.total) === 5 : Number(p.total) === 25000;
    if (isPerfect) {
      perfectPlayers.push(p);
    } else {
      normalNew.push(p);
    }
  }

  // 1. การ์ดทอง Perfect Score
  for (const p of perfectPlayers) {
    embeds.push(createScoreEmbed(challenge, week, p, false, null));
  }

  // 2. การ์ดคนเล่นใหม่
  if (normalNew.length > 0) {
    if (isInitialImport) {
      // หากเป็นการซิงค์รอบแรกที่มีคนเล่นมากกว่า 5 คน ให้สรุปเป็นการ์ดเดียว
      embeds.push(createInitialImportEmbed(challenge, week, newPlayers.length));
    } else if (normalNew.length <= 4) {
      // 1-4 คน ส่งการ์ดละเอียดรายบุคคล
      for (const p of normalNew) {
        embeds.push(createScoreEmbed(challenge, week, p, false, null));
      }
    } else {
      // มากกว่า 4 คน ส่งการ์ดสรุปรายการ
      embeds.push(createBatchNewScoresEmbed(challenge, week, normalNew));
    }
  }

  // 3. การ์ดคนที่มีการอัปเดตคะแนน
  for (const p of updatedPlayers) {
    embeds.push(createScoreEmbed(challenge, week, p, true, p.oldScore));
  }

  if (embeds.length > 0) {
    console.log(`     📢 กำลังส่งแจ้งเตือน Discord (${embeds.length} embeds)...`);
    await sendDiscordEmbeds(embeds);
  }
}

function scoreSingleSeedSync(pList, gameType = "standard") {
  if (!pList || pList.length === 0) return [];
  const isCountryCount = gameType === "country_count";

  for (let m = 0; m < 6; m++) {
    const maxScore = isCountryCount ? (m < 5 ? 1 : 5) : (m < 5 ? 5000 : 25000);

    pList.forEach((p) => {
      p.points = p.points || [];
      p.phantoms = p.phantoms || [];
      const raw = p.raw[m];
      p.phantoms[m] = isCountryCount ? raw : raw + 0.1 * Math.max(0, maxScore - raw);
    });

    pList.forEach((p, i) => {
      let ptsInRound = 0;
      const pRaw = p.raw[m];
      const pPhan = p.phantoms[m];

      if (isCountryCount && pRaw === 0) {
        p.points[m] = 0;
      } else {
        pList.forEach((opp, j) => {
          if (i === j) return;
          const oppRaw = opp.raw[m];
          const oppPhan = opp.phantoms[m];
          if (isCountryCount) {
            if (pRaw > oppRaw) ptsInRound += 1;
            else if (pRaw === oppRaw) ptsInRound += 0.5;
          } else {
            if (pRaw > oppPhan && oppRaw <= pPhan) ptsInRound += 1;
            else if (pRaw <= oppPhan && oppRaw <= pPhan) ptsInRound += 0.5;
          }
        });
        p.points[m] = ptsInRound;
      }
    });
  }

  pList.forEach((p) => {
    p.ptsRounds = p.points.reduce((a, b) => a + b, 0);
    p.ptsMap = Math.round(p.ptsRounds);
  });

  return pList;
}

/**
 * ส่งสรุปผลการ Freeze สัปดาห์ไปยัง Discord (Podium 1st, 2nd, 3rd ตาม League Points จริง)
 */
async function sendWeekFreezeSummary(week, challenges) {
  const isDiscordConfigured =
    DISCORD_WEBHOOK_URL || (DISCORD_BOT_TOKEN && DISCORD_ADMIN_CHANNEL_ID);

  if (!isDiscordConfigured) return;

  try {
    const challengeIds = challenges.map((c) => c.id);
    const { data: scores, error } =
      challengeIds.length === 0
        ? { data: [], error: null }
        : await fetchAllRows(() =>
            supabase
              .from("scores")
              .select("id, challenge_id, player_id, r1, r2, r3, r4, r5, total_score, players(id, username)")
              .in("challenge_id", challengeIds)
              .order("id", { ascending: true })
          );

    if (error || !scores || scores.length === 0) return;

    const scoresByCh = new Map();
    for (const s of scores) {
      if (!scoresByCh.has(s.challenge_id)) scoresByCh.set(s.challenge_id, []);
      scoresByCh.get(s.challenge_id).push(s);
    }

    // จัดกลุ่ม Map (1..7) เพื่อคำนวณ Multi-Seed เฉลี่ยให้ตรงกับหน้าเว็บ
    const mapGroups = new Map();
    for (const ch of challenges) {
      const m = ch.map_number || ch.seed_number;
      if (!mapGroups.has(m)) mapGroups.set(m, { mapNumber: m, gameType: ch.game_type || "standard", seeds: [] });
      mapGroups.get(m).seeds.push(ch);
    }

    const playerTotals = new Map();
    for (const [, grp] of mapGroups) {
      const seedCount = grp.seeds.length;
      const mapAgg = new Map();

      for (const ch of grp.seeds) {
        const rawList = scoresByCh.get(ch.id) || [];
        const pList = rawList.map((s) => ({
          userId: s.player_id,
          username: s.players?.username || "Anonymous",
          raw: [
            Number(s.r1) || 0,
            Number(s.r2) || 0,
            Number(s.r3) || 0,
            Number(s.r4) || 0,
            Number(s.r5) || 0,
            Number(s.total_score ?? ((s.r1 || 0) + (s.r2 || 0) + (s.r3 || 0) + (s.r4 || 0) + (s.r5 || 0))) || 0,
          ],
        }));

        scoreSingleSeedSync(pList, ch.game_type || "standard");
        for (const p of pList) {
          if (!mapAgg.has(p.userId)) {
            mapAgg.set(p.userId, { username: p.username, sumPts: 0 });
          }
          mapAgg.get(p.userId).sumPts += p.ptsMap;
        }
      }

      for (const [uid, agg] of mapAgg) {
        const ptsMap = seedCount === 1 ? agg.sumPts : Math.round((agg.sumPts / seedCount) * 10) / 10;
        if (!playerTotals.has(uid)) {
          playerTotals.set(uid, { username: agg.username, grandTotal: 0, mapsPlayed: 0 });
        }
        const pt = playerTotals.get(uid);
        pt.grandTotal = Math.round((pt.grandTotal + ptsMap) * 10) / 10;
        pt.mapsPlayed += 1;
      }
    }

    const sortedPlayers = Array.from(playerTotals.values()).sort((a, b) => b.grandTotal - a.grandTotal);
    const totalParticipants = sortedPlayers.length;

    const uniqueMapsCount = new Set(
      (challenges || [])
        .filter((c) => c.token && c.token.trim() !== "")
        .map((c) => c.map_number || c.seed_number)
    ).size;
    const totalMapsCount = uniqueMapsCount > 0 ? uniqueMapsCount : 7;
    const activeSeedsCount = (challenges || []).filter((c) => c.token && c.token.trim() !== "").length;

    const medals = ["🥇", "🥈", "🥉"];
    const topLines = sortedPlayers
      .slice(0, 5)
      .map((p, idx) => {
        const medal = medals[idx] || `**#${idx + 1}**`;
        const ptsFmt = Number(p.grandTotal).toLocaleString(undefined, { maximumFractionDigits: 1 });
        return `${medal} **${p.username}** — \`${ptsFmt}\` pts (${p.mapsPlayed}/${totalMapsCount} maps)`;
      })
      .join("\n");

    const embed = {
      title: `🏆 ปิดรอบการแข่งขันสัปดาห์: ${week.title}!`,
      description: `❄️ สัปดาห์นี้ถึงกำหนดส่งผลและถูก **Freeze** สรุปคะแนนเรียบร้อยแล้ว!\n\n**Top Leaderboard (League Points):**\n${topLines}`,
      color: 0x9B59B6, // Purple
      fields: [
        { name: "👥 ผู้เข้าร่วมทั้งหมด", value: `**${totalParticipants}** คน`, inline: true },
        { name: "🗺️ จำนวนด่าน", value: `**${totalMapsCount}** Maps (${activeSeedsCount} Seeds)`, inline: true },
      ],
      footer: {
        text: `GeoGuessr Weekly Challenge • Auto Freeze Summary`,
      },
      timestamp: new Date().toISOString(),
    };

    await sendDiscordMessage({ embeds: [embed] });
    console.log(`     📢 ส่งสรุปผลการ Freeze สัปดาห์ "${week.title}" ไปยัง Discord สำเร็จ`);
  } catch (err) {
    console.warn("⚠️ ไม่สามารถส่งสรุปผลการ Freeze สัปดาห์ไปยัง Discord:", err.message);
  }
}

// ====================================================================
// GeoGuessr API Fetcher
// ====================================================================

/**
 * ดึงผลลัพธ์ Challenge ทั้งหมดจาก GeoGuessr API (พร้อมรองรับ Pagination และ Game Type)
 */
async function fetchChallengeResults(token, gameType = "standard") {
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
        if ((resp.status === 401 || resp.status === 403) && !hasNotifiedCookieError) {
          hasNotifiedCookieError = true;
          await sendDiscordMessage({
            embeds: [
              {
                title: "🚨 แจ้งเตือน: GeoGuessr Cookie หมดอายุ!",
                description: `ระบบ Sync ไม่สามารถดึงคะแนนได้เนื่องจากติดสิทธิ์ **HTTP ${resp.status} Unauthorized/Forbidden**\n\nโปรดเข้าเว็บ GeoGuessr เพื่อคัดลอก Cookie ค่า \`_ncfa\` ใหม่ แล้วนำไปอัปเดตใน **GitHub Secrets** (\`GEOGUESSR_COOKIE\`) เพื่อให้ระบบสามารถดึงคะแนนต่อได้`,
                color: 0xE74C3C, // Red
                footer: { text: "GeoGuessr Weekly Challenge • Sync Alert" },
                timestamp: new Date().toISOString(),
              },
            ],
          });
        }
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

        let r1, r2, r3, r4, r5, total;
        let roundDetails = null;

        if (gameType === "country_count") {
          const rounds = Array.isArray(item.game?.rounds) ? item.game.rounds : [];
          const checks = [];
          for (let idx = 0; idx < 5; idx++) {
            const res = await checkRoundCountryMatch(rounds[idx], guesses[idx]);
            checks.push(res);
          }
          r1 = checks[0].ok ? 1 : 0;
          r2 = checks[1].ok ? 1 : 0;
          r3 = checks[2].ok ? 1 : 0;
          r4 = checks[3].ok ? 1 : 0;
          r5 = checks[4].ok ? 1 : 0;
          total = r1 + r2 + r3 + r4 + r5;
          roundDetails = checks;
        } else {
          r1 = Number(guesses[0]?.roundScoreInPoints) || 0;
          r2 = Number(guesses[1]?.roundScoreInPoints) || 0;
          r3 = Number(guesses[2]?.roundScoreInPoints) || 0;
          r4 = Number(guesses[3]?.roundScoreInPoints) || 0;
          r5 = Number(guesses[4]?.roundScoreInPoints) || 0;
          total = Number(item.totalScore ?? (r1 + r2 + r3 + r4 + r5)) || 0;
        }

        // ดึงเวลาที่เล่นจริง (Timestamp) จากรอบสุดท้าย หรือรอบแรก หรือข้อมูลเกม
        const playedAt =
          guesses[4]?.createdAt ||
          guesses[4]?.created ||
          guesses[4]?.date ||
          guesses[0]?.createdAt ||
          guesses[0]?.created ||
          guesses[0]?.date ||
          item.game?.player?.createdAt ||
          item.game?.player?.created ||
          item.game?.player?.date ||
          item.game?.createdAt ||
          item.game?.created ||
          item.game?.date ||
          item.createdAt ||
          item.created ||
          item.date ||
          item.timestamp ||
          (function scan(obj, depth = 0) {
            if (!obj || depth > 4) return null;
            if (typeof obj === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) return obj;
            if (typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (/create|date|play|time/i.test(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
              }
              for (const v of Object.values(obj)) {
                const found = scan(v, depth + 1);
                if (found) return found;
              }
            }
            return null;
          })(item);

        // ดึงเวลารวมที่ใช้เล่น (หน่วยเป็นวินาที)
        const totalTime =
          Number(item.game?.player?.totalTime) ||
          guesses.reduce((sum, g) => sum + (Number(g?.time) || 0), 0) ||
          null;

        players.push({
          userId,
          username,
          r1,
          r2,
          r3,
          r4,
          r5,
          total,
          playedAt,
          totalTime,
          roundDetails,
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

// ====================================================================
// ฟังก์ชันหลักในการซิงค์ข้อมูล
// ====================================================================

async function main() {
  console.log("🚀 เริ่มต้นกระบวนการ Sync คะแนน GeoGuessr Weekly Challenge...");
  const isDiscordActive =
    DISCORD_WEBHOOK_URL || (DISCORD_BOT_TOKEN && DISCORD_ADMIN_CHANNEL_ID);
  if (isDiscordActive) {
    console.log(
      `🔔 ระบบ Discord Alert เปิดใช้งาน (${DISCORD_BOT_TOKEN ? "Bot Token" : "Webhook"})`
    );
  } else {
    console.log("ℹ️ ระบบ Discord Alert ยังไม่ได้ตั้งค่า (จะทำงานเฉพาะบันทึกฐานข้อมูล)");
  }

  // 1. ดึงสัปดาห์ทั้งหมดที่ยังไม่ Freeze (is_frozen = false)
  const { data: nonFrozenWeeks, error: weekError } = await supabase
    .from("weeks")
    .select("*")
    .eq("is_frozen", false);

  if (weekError) {
    console.error("❌ ไม่สามารถดึงข้อมูลสัปดาห์จาก Supabase:", weekError.message);
    process.exit(1);
  }

  if (!nonFrozenWeeks || nonFrozenWeeks.length === 0) {
    console.log("ℹ️ ไม่มีสัปดาห์ที่กำลังแข่งขันอยู่ (ทุกสัปดาห์ Freeze หมดแล้ว)");
    return;
  }

  const now = new Date();

  // ดึงเฉพาะสัปดาห์ที่ Active และถึงเวลาเริ่มแล้วจริง ๆ เพื่อดึงคะแนน
  const activeWeeks = nonFrozenWeeks.filter((w) => {
    if (!w.is_active) return false;
    if (w.start_date && now < new Date(w.start_date)) return false;
    return true;
  });

  if (activeWeeks.length === 0) {
    console.log("ℹ️ ไม่มีสัปดาห์ที่เปิดการแข่งขันอยู่ในขณะนี้ (สัปดาห์ที่เหลือเป็น Draft หรือยังไม่ถึงเวลาเริ่ม)");
  }

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
        await sendWeekFreezeSummary(week, []);
      }
      continue;
    }

    // เรียงลำดับตาม map_number -> sub_seed_number ใน JS (รองรับทั้งก่อนและหลัง Migration)
    challenges.sort((a, b) => {
      const mA = a.map_number || a.seed_number || 0;
      const mB = b.map_number || b.seed_number || 0;
      if (mA !== mB) return mA - mB;
      return (a.sub_seed_number || 1) - (b.sub_seed_number || 1);
    });

    // นับจำนวน sub-seed ต่อ Map เพื่อให้ Discord Label แสดงชัด
    const mapSeedCounts = new Map();
    for (const ch of challenges) {
      const m = ch.map_number || ch.seed_number;
      mapSeedCounts.set(m, (mapSeedCounts.get(m) || 0) + 1);
    }
    for (const ch of challenges) {
      const m = ch.map_number || ch.seed_number;
      ch.hasMultiSeed = (mapSeedCounts.get(m) || 1) > 1;
    }

    console.log(`🔍 พบทั้งหมด ${challenges.length} seeds สำหรับ ${week.title}`);

    // ดึงรายชื่อผู้เล่นที่ถูก DQ ในสัปดาห์นี้ (ถ้ามีตาราง disqualified_players)
    const dqSet = new Set();
    try {
      const { data: dqRows, error: dqErr } = await supabase
        .from("disqualified_players")
        .select("player_id")
        .eq("week_id", week.id);
      if (!dqErr && Array.isArray(dqRows)) {
        dqRows.forEach((row) => dqSet.add(row.player_id));
      }
    } catch (dqCheckErr) {}

    // เตรียมตัวแปรรวบรวมข้อมูลทุก Seeds เพื่อ Batch Upsert ตูมเดียว
    // ป้องกันไม่ให้หน้าเว็บที่ต่อ Realtime รีเฟรชกระพริบซ้ำๆ
    const allPlayerUpsertsMap = new Map();
    const allScoreUpserts = [];
    const pendingNotifications = [];

    for (const challenge of challenges) {
      const mapNum = challenge.map_number || challenge.seed_number;
      const subSeedNum = challenge.sub_seed_number || 1;
      const gameType = challenge.game_type || "standard";

      if (!challenge.token || challenge.token.trim() === "") {
        console.log(`  -> Map ${mapNum} (Seed ${subSeedNum}): ยังไม่มี Token/ลิงก์ Challenge (ข้าม)`);
        continue;
      }

      console.log(
        `  -> กำลังดึง Map ${mapNum} (Seed ${subSeedNum}, Type: ${gameType}, Token: ${challenge.token})...`
      );
      const rawResults = await fetchChallengeResults(challenge.token, gameType);
      const results = dqSet.size > 0 ? rawResults.filter((r) => !dqSet.has(r.userId)) : rawResults;
      console.log(`     ได้ข้อมูลผู้เล่นครบ 5 รอบ: ${results.length} คน`);

      if (results.length === 0) continue;

      // ตรวจสอบกฎปรับแก้คะแนนพิเศษ (Score Adjustments) สำหรับ Challenge นี้
      try {
        const { data: adjustments } = await supabase
          .from("score_adjustments")
          .select("*")
          .eq("challenge_id", challenge.id);

        if (adjustments && adjustments.length > 0) {
          for (const adj of adjustments) {
            const rKey = `r${adj.round_number}`;
            let adjustedCount = 0;
            results.forEach((r) => {
              let changed = false;
              if (gameType === "country_count") {
                if (adj.rule_type === "void_round") {
                  r[rKey] = 1;
                  changed = true;
                }
              } else {
                if (adj.rule_type === "threshold_to_max" && r[rKey] >= adj.min_score) {
                  r[rKey] = adj.target_score;
                  changed = true;
                } else if (adj.rule_type === "void_round") {
                  r[rKey] = adj.target_score || 5000;
                  changed = true;
                } else if (adj.rule_type === "bonus_points" && adj.bonus_points > 0) {
                  r[rKey] = Math.min(5000, r[rKey] + adj.bonus_points);
                  changed = true;
                }
              }

              if (changed) {
                adjustedCount++;
                r.total = r.r1 + r.r2 + r.r3 + r.r4 + r.r5;
              }
            });
            if (adjustedCount > 0) {
              console.log(
                `     🎯 ใช้กฎปรับคะแนน Round ${adj.round_number} (${adj.rule_type}): อัปเดต ${adjustedCount} คน`
              );
            }
          }
        }
      } catch (adjErr) {
        // ข้ามอย่างปลอดภัยหากยังไม่ได้สร้างตาราง score_adjustments
      }

      // ดึงคะแนนเดิมที่มีในฐานข้อมูลเพื่อเปรียบเทียบหาคะแนนใหม่ / มีการอัปเดต
      let existingScores = [];
      try {
        let { data: exScores, error: exErr } = await fetchAllRows(() =>
          supabase
            .from("scores")
            .select("id, player_id, total_score, r1, r2, r3, r4, r5, played_at, total_time, is_manual")
            .eq("challenge_id", challenge.id)
            .order("id", { ascending: true })
        );

        if (
          exErr &&
          (exErr.message?.includes("played_at") ||
            exErr.message?.includes("is_manual") ||
            exErr.code === "PGRST204")
        ) {
          const fallback = await fetchAllRows(() =>
            supabase
              .from("scores")
              .select("id, player_id, total_score, r1, r2, r3, r4, r5")
              .eq("challenge_id", challenge.id)
              .order("id", { ascending: true })
          );
          exScores = fallback.data;
        }
        existingScores = exScores || [];
      } catch (exErr) {
        console.warn("     ⚠️ ดึง existing scores ไม่สำเร็จ:", exErr.message);
      }

      const existingMap = new Map();
      for (const s of existingScores) {
        existingMap.set(s.player_id, s);
      }

      // ตรวจหาคะแนนใหม่และคะแนนที่เปลี่ยนแปลง (ข้ามแถวที่แอดมินแก้ด้วยมือ is_manual = true)
      const newPlayers = [];
      const updatedPlayers = [];
      const activeResults = [];

      for (const r of results) {
        const existing = existingMap.get(r.userId);
        if (existing?.is_manual) {
          continue;
        }
        activeResults.push(r);

        if (!existing) {
          newPlayers.push(r);
        } else if (
          Number(existing.total_score) !== Number(r.total) ||
          Number(existing.r1) !== Number(r.r1) ||
          Number(existing.r2) !== Number(r.r2) ||
          Number(existing.r3) !== Number(r.r3) ||
          Number(existing.r4) !== Number(r.r4) ||
          Number(existing.r5) !== Number(r.r5)
        ) {
          updatedPlayers.push({ ...r, oldScore: existing.total_score });
        }
      }

      const isInitialImport = existingMap.size === 0 && activeResults.length > 5;

      // รวบรวมข้อมูลผู้เล่น (Deduplicate ตาม userId)
      for (const r of activeResults) {
        allPlayerUpsertsMap.set(r.userId, {
          id: r.userId,
          username: r.username,
          updated_at: new Date().toISOString(),
        });
      }

      // รวบรวมเฉพาะคะแนนที่เพิ่มใหม่หรือมีการเปลี่ยนแปลง/เติมข้อมูลเวลาที่ขาด
      for (const r of activeResults) {
        const existing = existingMap.get(r.userId);
        const scoreChanged =
          !existing ||
          Number(existing.total_score) !== Number(r.total) ||
          Number(existing.r1) !== Number(r.r1) ||
          Number(existing.r2) !== Number(r.r2) ||
          Number(existing.r3) !== Number(r.r3) ||
          Number(existing.r4) !== Number(r.r4) ||
          Number(existing.r5) !== Number(r.r5);
        const missingMeta =
          Boolean(existing) &&
          ((r.playedAt && !existing.played_at) || (r.totalTime && !existing.total_time));

        if (!scoreChanged && !missingMeta) continue;

        const itemObj = {
          challenge_id: challenge.id,
          player_id: r.userId,
          r1: r.r1,
          r2: r.r2,
          r3: r.r3,
          r4: r.r4,
          r5: r.r5,
          total_score: r.total,
          updated_at: new Date().toISOString(),
        };
        if (r.playedAt) itemObj.played_at = r.playedAt;
        if (r.totalTime) itemObj.total_time = r.totalTime;
        if (r.roundDetails) itemObj.round_details = r.roundDetails;
        allScoreUpserts.push(itemObj);
      }

      // บันทึกรายการแจ้งเตือนที่ต้องส่ง Discord
      if (newPlayers.length > 0 || updatedPlayers.length > 0) {
        pendingNotifications.push({
          challenge,
          week,
          newPlayers,
          updatedPlayers,
          isInitialImport,
        });
      }
    }

    // ================================================================
    // บันทึกข้อมูลลงฐานข้อมูลแบบ Batch (แบ่ง chunk ละ 500 ป้องกัน payload เกิน)
    // ================================================================
    if (allPlayerUpsertsMap.size > 0) {
      console.log(`\n  💾 กำลังบันทึกข้อมูลผู้เล่นรวม ${allPlayerUpsertsMap.size} คน...`);
      const playerUpserts = Array.from(allPlayerUpsertsMap.values());
      for (let i = 0; i < playerUpserts.length; i += 500) {
        const chunk = playerUpserts.slice(i, i + 500);
        const { error: pErr } = await supabase
          .from("players")
          .upsert(chunk, { onConflict: "id" });
        if (pErr) console.warn("  ⚠️ เตือน: อัปเดตตาราง players ไม่สำเร็จ:", pErr.message);
      }
    }

    if (allScoreUpserts.length > 0) {
      console.log(`  💾 กำลังบันทึกคะแนนใหม่/อัปเดต ${allScoreUpserts.length} รายการ (Batch Upsert)...`);
      for (let i = 0; i < allScoreUpserts.length; i += 500) {
        const chunk = allScoreUpserts.slice(i, i + 500);
        let { error: sErr } = await supabase
          .from("scores")
          .upsert(chunk, { onConflict: "challenge_id,player_id" });

        // กรณีที่ Supabase ยังไม่ได้รัน ALTER TABLE เพิ่มคอลัมน์ round_details / played_at / total_time
        if (
          sErr &&
          (sErr.message?.includes("round_details") ||
            sErr.message?.includes("played_at") ||
            sErr.message?.includes("total_time") ||
            sErr.code === "PGRST204")
        ) {
          console.warn("  ℹ️ กำลัง fallback บันทึก scores (บางคอลัมน์เสริมยังไม่มีในตาราง)...");
          const withoutRoundDetails = chunk.map(({ round_details, ...rest }) => rest);
          const { error: fb1Err } = await supabase
            .from("scores")
            .upsert(withoutRoundDetails, { onConflict: "challenge_id,player_id" });
          if (fb1Err) {
            const fallbackBasic = chunk.map(({ round_details, played_at, total_time, ...rest }) => rest);
            const { error: fb2Err } = await supabase
              .from("scores")
              .upsert(fallbackBasic, { onConflict: "challenge_id,player_id" });
            if (fb2Err) console.warn("  ⚠️ เตือน: อัปเดตตาราง scores ไม่สำเร็จ:", fb2Err.message);
          }
        } else if (sErr) {
          console.warn("  ⚠️ เตือน: อัปเดตตาราง scores ไม่สำเร็จ:", sErr.message);
        }
      }
    } else {
      console.log("  ✅ ไม่มีคะแนนใหม่หรือคะแนนที่เปลี่ยนแปลง");
    }

    // ส่งแจ้งเตือน Discord สำหรับทุก Challenge ที่มีคะแนนใหม่
    for (const notif of pendingNotifications) {
      await notifyScoreChanges(
        notif.challenge,
        notif.week,
        notif.newPlayers,
        notif.updatedPlayers,
        notif.isInitialImport
      );
    }

    // อัปเดตเวลา Last Update ของสัปดาห์นี้
    await supabase
      .from("weeks")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", week.id);

    // หากถึงเวลาตัดรอบ ให้ Freeze สัปดาห์นี้ทันทีหลังจาก Sync รอบสุดท้ายเสร็จ
    if (shouldFreeze) {
      await supabase.from("weeks").update({ is_frozen: true, is_active: false }).eq("id", week.id);
      week.is_frozen = true;
      week.is_active = false;
      console.log(`❄️ ถึงเวลาตัดรอบแล้ว: ทำการ Freeze สัปดาห์ "${week.title}" สำเร็จ!`);
      await sendWeekFreezeSummary(week, challenges);
    }
  }

  // 2. ตรวจสอบ Auto-Activate สำหรับสัปดาห์ถัดไปที่กำหนด start_date ไว้ และถึงเวลาเริ่มแล้ว
  for (const week of nonFrozenWeeks) {
    if (!week.is_frozen && !week.is_active && week.start_date && now >= new Date(week.start_date)) {
      console.log(`🚀 ถึงเวลาเริ่มการแข่งขัน! ทำการ Auto-Activate สัปดาห์ใหม่: ${week.title} (ID: ${week.id})`);
      await supabase.from("weeks").update({ is_active: false }).neq("id", week.id);
      await supabase.from("weeks").update({ is_active: true }).eq("id", week.id);
      week.is_active = true;
    }
  }

  console.log("\n✅ สิ้นสุดกระบวนการ Sync คะแนนเรียบร้อยแล้ว!");
}

main().catch(async (err) => {
  console.error("❌ Fatal Error:", err);
  try {
    await sendDiscordMessage({
      embeds: [
        {
          title: "❌ เกิดข้อผิดพลาดร้ายแรงในระบบ Sync!",
          description: `พบ Fatal Error ขณะรันกระบวนการ Sync:\n\`\`\`${String(err.message || err).substring(0, 1500)}\`\`\``,
          color: 0xE74C3C,
          footer: { text: "GeoGuessr Weekly Challenge • Sync Failure Alert" },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (notifyErr) {}
  process.exit(1);
});
