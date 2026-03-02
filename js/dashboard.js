import { db } from "./firebase.js";
import { ref, get, update, runTransaction, remove } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


/* ======================
   🔹 NAVIGATION
====================== */
const navDashboard = document.getElementById("navDashboard");
const navBossList = document.getElementById("navBossList");
const dashboardSection = document.getElementById("dashboardSection");
const bossListContainer = document.getElementById("bossListContainer");
const dashboardCards = document.getElementById("dashboardCards");

const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

navToggle.addEventListener("click", () => {
  navLinks.classList.toggle("show");
});

let isAuthorized = false;

navDashboard.addEventListener("click", () => {
  navDashboard.classList.add("active");
  navBossList.classList.remove("active");
  dashboardSection.style.display = "block";
  bossListContainer.style.display = "none";
  fetchAndRenderBosses();
});

navBossList.addEventListener("click", async () => {
  if (!isAuthorized) {
    const entered = prompt("Enter admin access token:");
    if (!entered) return alert("❌ Invalid token");
    try {
      const snap = await get(ref(db, "tokens/" + entered.trim()));
      if (!snap.exists() || snap.val() !== true) return alert("❌ Invalid token");
      isAuthorized = true;
      alert("✅ Access granted!");
    } catch (err) {
      console.error(err);
      return alert("❌ Token check failed");
    }
  }

  navBossList.classList.add("active");
  navDashboard.classList.remove("active");
  dashboardSection.style.display = "none";
  bossListContainer.style.display = "block";

  if (!document.getElementById("bossListSection")) {
    const html = await (await fetch("bosslist.html")).text();
    bossListContainer.innerHTML = html;
    const { initBossList } = await import("./bosslist.js");
    initBossList();
  }
});

/* ======================
   🔹 CONSTANTS
====================== */

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1477526318202749090/Lxo07w40ZGx0U2uBOenVgxswG_RIBLOMpk-gfFIYh22Vc3Rwz6NpzdWIrLlnoWBzSfwB";
const TEN_MIN = 10 * 60000;
const FIVE_MIN = 5 * 60000;

const countdownTimers = new Map();


/* ======================
   🔹 DISCORD
====================== */

function sendDiscordMessage(msg) {
  fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg })
  });
}

function discordTemplate(title, status, lvl) {
  return (
`📢 @everyone
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                 🐦‍🔥 **${title}** 🐦‍🔥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${lvl}
${status}
📆 Time: <t:${Math.floor(Date.now()/1000)}:F>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

/* ======================
   🔹 TIMEZONE
====================== */

let displayOffset = 8;
const timezoneSelect = document.getElementById("timezoneSelect");

function formatWithTimezone(date) {
  if (!date) return "N/A";

  if (displayOffset === "local") {
    return date.toLocaleString([], {
      dateStyle: "short",
      timeStyle: "short",
      hour12: true,
    });
  }

  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const adjusted = new Date(utc + displayOffset * 3600000);

  return adjusted.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
    hour12: true,
  });
}

function formatCountdown(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return "00 hrs : 00 mns : 00 secs";

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return `${h.toString().padStart(2,"0")} hrs : ${m.toString().padStart(2,"0")} mns : ${s.toString().padStart(2,"0")} secs`;
}

/* ======================
   🔹 SCHEDULE LOGIC
====================== */

function getNextScheduledSpawn(scheduleStr) {
  if (!scheduleStr) return null;

  const now = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const entries = scheduleStr.split(",").map(e => e.trim());

  let soonest = null;

  for (const entry of entries) {
    const [dayStr, timeStr] = entry.split(" ");
    const dayIndex = days.findIndex(d => d.toLowerCase() === dayStr.toLowerCase());
    if (dayIndex === -1 || !timeStr) continue;

    const [hour, minute] = timeStr.split(":").map(Number);

    let candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);

    const diffDays = (dayIndex - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diffDays);

    if (candidate < now) candidate.setDate(candidate.getDate() + 7);
    if (!soonest || candidate < soonest) soonest = candidate;
  }

  return soonest;
}

/* ======================
   🔹 FETCH & RENDER
====================== */

async function fetchAndRenderBosses() {

  countdownTimers.forEach(clearInterval);
  countdownTimers.clear();

  const dashboardCards = document.getElementById("dashboardCards");

  try {
    const snapshot = await get(ref(db, "bosses"));
    if (!snapshot.exists()) {
      dashboardCards.innerHTML = "<p>No bosses found</p>";
      return;
    }

    const now = new Date();
    const today = now.getDate();
    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(today + 1);

    const bosses = [];

    snapshot.forEach(child => {
      const b = child.val();
      b._key = child.key;

      let ts = Date.parse(b.nextSpawn);

      if (b.bossSchedule && !b.bossHour) {
        const next = getNextScheduledSpawn(b.bossSchedule);
        ts = next ? next.getTime() : Infinity;
      }

      b._ts = isNaN(ts) ? Infinity : ts;
      bosses.push(b);
    });

    bosses.sort((a,b)=>a._ts - b._ts);

    const groups = { soon: [], today: [], tomorrow: [], later: [] };

    bosses.forEach(b => {
      const nextDate = new Date(b._ts);
      const diff = b._ts - Date.now();

      if (diff <= TEN_MIN && diff > -FIVE_MIN) groups.soon.push(b);
      else if (nextDate.getDate() === today) groups.today.push(b);
      else if (nextDate.getDate() === tomorrowDate.getDate()) groups.tomorrow.push(b);
      else groups.later.push(b);
    });

    dashboardCards.innerHTML = "";

    const sections = [
      { label: "🕑 Spawning", color: "#66ff00ff", data: groups.soon },
      { label: "🌞 Today", color: "#007bff", data: groups.today },
      { label: "🌙 Tomorrow", color: "#6f42c1", data: groups.tomorrow },
      { label: "🌅 Coming Soon", color: "#e98e07ff", data: groups.later },
    ];

    sections.forEach(section => {
      if (section.data.length === 0) return;

      const sectionContainer = document.createElement("div");
      sectionContainer.style.marginBottom = "2rem";

      const header = document.createElement("h2");
      header.textContent = section.label;
      header.style.color = section.color;
      header.style.fontWeight = "800";
      header.style.fontSize = "1.3rem";
      header.style.margin = "10px 0";
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.cursor = "pointer";
      header.style.padding = "8px 12px";
      header.style.borderBottom = `2px solid ${section.color}`;
      header.style.background = "rgba(0,0,0,0.05)";
      header.style.borderRadius = "6px";

      const toggle = document.createElement("span");
      toggle.textContent = "▼";
      header.appendChild(toggle);

      const grid = document.createElement("div");
      grid.className = "boss-grid";
      grid.style.margin = "10px auto";
      grid.style.padding = "0 10px";
      grid.style.overflow = "hidden";
      grid.style.transition = "max-height 0.4s ease, opacity 0.4s ease";

      section.data.forEach(b => grid.appendChild(createBossCard(b, section.color)));

      header.addEventListener("click", () => {
        const collapsed = grid.classList.toggle("collapsed");
        grid.style.display = collapsed ? "none" : "grid";
        toggle.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
      });

      sectionContainer.append(header, grid);
      dashboardCards.appendChild(sectionContainer);
    });

  } catch (err) {
    console.error(err);
    dashboardCards.innerHTML = "<p>Error loading bosses</p>";
  }
}

/* ======================
   🔹 CARD
====================== */

function createBossCard(b, sectionColor) {

  const card = document.createElement("div");
  card.className = "boss-tile";
  card.style.borderLeft = `6px solid ${sectionColor}`;

  card.addEventListener("mouseenter", () => (card.style.transform = "scale(1.03)"));
  card.addEventListener("mouseleave", () => (card.style.transform = "scale(1)"));

  const bossImageMap = {
    VENATUS: "img/venatus.png",
    VIORENT: "img/viorent.png",
    EGO: "img/ego.png",
    LIVERA: "img/livera_fool.png",
    ARANEO: "img/araneo.png",
    NEUTRO: "img/neutro_fool.png",
    SAPHIRUS: "img/saphirus.png",
    THYMELE: "img/thymele.png",
    UNDOMIEL: "img/undomiel.png",
    WANNITAS: "img/wannitas.png",
    DUPLICAN: "img/duplican.png",
    METUS: "img/metus_fool.png",
    AMENTIS: "img/amentis.png",
    CLEMANTIS: "img/clemantis.png",
    TITORE: "img/titore.png",
    GARETH: "img/gareth.png",
    LADYDALIA: "img/lady_dalia.png",
    GENAQULUES: "img/gen_aquleus.png",
    GENERALAQULES: "img/gen_aquleus.png",
    GENAQULEUS: "img/gen_aquleus.png",
    AURAQ: "img/auraq_fool.png",
    MILAVY: "img/milavy.png",
    CHAIFLOCK: "img/chaiflock.png",
    RODERICK: "img/roderick_fool.png",
    RINGOR: "img/ringor_fool.png",
    BENJI: "img/benji_fool.png",
    SHULIAR: "img/shuliar.png",
    LARBA: "img/larba_fool.png",
    BARON: "img/baron_fool.png",
    CATENA: "img/catena.png",
    ORDO: "img/ordo.png",
    SECRETA: "img/secreta.png",
    SUPORE: "img/supore.png",
    ASTA: "img/asta.png",
    LIBITINA: "img/libitina.png",
    RAKAJETH: "img/rakajeth.png",
    TUMIER: "img/tumier.png"
  };

  const normalizedName =
    b.bossName?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "";

  const imgSrc = bossImageMap[normalizedName] || "img/default.png";

  const img = document.createElement("img");
  img.src = imgSrc;
  img.alt = b.bossName;
  img.className = "boss-tile-img";
  card.appendChild(img);

  const info = document.createElement("div");
  info.className = "boss-tile-info";
  card.appendChild(info);

  const guild = b.guild || "FACTION";

  const guildTag = document.createElement("span");
  guildTag.textContent = "🜲 " + guild;
  guildTag.className = `guild-badge ${guild}`;
  info.appendChild(guildTag);

  const bossTypeTag = document.createElement("span");
  bossTypeTag.textContent =
    b.bossHour && b.bossHour !== "null" ? "Respawnable" : "Scheduled";
  bossTypeTag.className = `guild-badge ${guild}`;
  info.appendChild(bossTypeTag);

  const nameRow = document.createElement("div");
  nameRow.className = "boss-name-row";

  const title = document.createElement("h3");
  title.textContent = b.bossName || "Unknown";
  nameRow.appendChild(title);

  const lvlTag = document.createElement("span");
  lvlTag.textContent = "Lv. " + (b.lvl || "0");
  lvlTag.className = `level-badge ${guild}`;
  nameRow.appendChild(lvlTag);

  info.appendChild(nameRow);

  const countdown = document.createElement("span");
  countdown.className = "countdown";
  info.appendChild(countdown);

  const spawnInfo = document.createElement("p");
  spawnInfo.innerHTML =
    `<span style="color:#666;font-weight:bold">Spawn:</span> 
     <strong>${formatWithTimezone(new Date(b._ts))}</strong>`;
  info.appendChild(spawnInfo);

  /* ======================
     🔹 COUNTDOWN + DISCORD + RESET/REMOVE
  ====================== */

  const interval = setInterval(async () => {

    const now = Date.now();
    const diff = b._ts - now;
    const estMinutes = b.est || 5;

    /* 🔁 AUTO RESET (bossHour) */
    if (
      (b.bossHour || b.bossHour !== "null") &&
      (!b.bossSchedule || b.bossSchedule === "" || b.bossSchedule === "null") &&
      diff <= -(estMinutes * 60000) &&
      !b.cycleReset
    ) {
      const now = new Date(); 
      const newNextSpawn = new Date(now + (b.bossHour * 60 * 60 * 1000));

      await update(ref(db, `bosses/${b._key}`), {
        lastKilled: now.toISOString(),
        nextSpawn: newNextSpawn.toISOString(),
        warned10m: false,
        spawnedPinged: false,
        cycleReset: true
      });

      b._ts = newNextSpawn.getTime();
      b.cycleReset = true;
    }

    /* ❌ AUTO REMOVE (bossSchedule) */
    if (
      (b.bossSchedule || b.bossSchedule !== "null") &&
      (!b.bossHour || b.bossHour === "" || b.bossHour === "null") &&
      diff <= -(estMinutes * 60000)
    ) {
      await remove(ref(db, `bosses/${b._key}`));
      // clearInterval(countdownTimers.get(b._key));
      // countdownTimers.delete(b._key);
      return;
    }

    if (diff > 0 && diff <= TEN_MIN) {
      const warnRef = ref(db, `bosses/${b._key}/warned10m`);
      const result = await runTransaction(warnRef, cur => cur === true ? undefined : true);
      if (result.committed) {
        sendDiscordMessage(discordTemplate(
          b.bossName,
          "⏳ Status: **Spawning in approximately 10 minutes!**",
          "🎖️ Level:" + b.lvl,
        ));
      }
    }

    if (diff <= 0 && diff > -1000) {
      const spawnRef = ref(db, `bosses/${b._key}/spawnedPinged`);
      const result = await runTransaction(spawnRef, cur => cur === true ? undefined : true);
      if (result.committed) {
        sendDiscordMessage(discordTemplate(
          b.bossName,
          "🔥 Status: **SPAWNED!**",
          "🎖️ Level:" + b.lvl,
        ));
      }
    }

    if (diff <= 0 && diff > -FIVE_MIN) {
      countdown.textContent = "SPAWNING NOW!";
      countdown.style.color = "red";
      card.style.borderLeftColor = "red";
    }
    else if (diff > 0) {
      countdown.textContent = formatCountdown(b._ts);
    }
    else {
      countdown.textContent = "Spawn Passed";
      countdown.style.color = "#777";
      card.style.borderLeftColor = "#777";
    }

  }, 1000);

  countdownTimers.set(b._key, interval);

  return card;
}


/* ======================
   🔹 INIT
====================== */

window.addEventListener("DOMContentLoaded", fetchAndRenderBosses);

timezoneSelect.addEventListener("change", () => {
  const val = timezoneSelect.value;
  displayOffset = val === "local" ? "local" : parseFloat(val);
  localStorage.setItem("displayOffset", val);
  fetchAndRenderBosses();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) fetchAndRenderBosses();
});




