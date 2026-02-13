import { db } from "./firebase.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1471289464637755426/ZksHMuTzLZ_AAe_PJzVpFdxQOm_2Vb_IfAOXlCS3tYCdeYTRdBxh5SXlt_TBahgEglDo";

function sendDiscordMessage(msg) {
  fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: msg })
  });
}


/* ======================
   🔹 TIMEZONE SYSTEM (FIXED)
====================== */
// 🔹 Default display offset (hours)
let displayOffset = 8; // default UTC+8
const timezoneSelect = document.getElementById("timezoneSelect");
let tzIndex = 0;

// const timezones = [
//   { label: "UTC+8", offset: 8 },
//   { label: "UTC+7", offset: 7 },
//   { label: "UTC+4", offset: 4 },
// ];

const btnTimezone = document.getElementById("btnTimezone");

const countdownTimers = new Map();
// Always use real current time (never converted)
function nowUTC() {
  return new Date();
}

// Format spawn time for display
function formatWithTimezone(date) {
  const offset = parseFloat(displayOffset); // just the chosen UTC offset
  const utcTime = date.getTime() + date.getTimezoneOffset() * 60000;
  const localTime = new Date(utcTime + offset * 3600000);

  return localTime.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
    hour12: true,
  });
}

// Countdown always uses real timestamps
// function formatCountdown(targetDate) {
//   const diff = targetDate - nowUTC();
//   if (diff <= 0) return "00 hrs : 00 mns : 00 secs";

//   const hours = Math.floor(diff / (1000 * 60 * 60));
//   const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
//   const seconds = Math.floor((diff % (1000 * 60)) / 1000);

//   return `${hours.toString().padStart(2, "0")} hrs : ${minutes
//     .toString()
//     .padStart(2, "0")} mns : ${seconds.toString().padStart(2, "0")} secs`;
// }

function formatCountdown(targetDate) {
  const offset = parseFloat(displayOffset); // e.g., 7, 8
  const utcNow = nowUTC().getTime();
  
  // shift current time to the selected timezone
  const localNow = utcNow + (offset - 8) * 3600_000; // 8 = original PH offset
  const diff = targetDate.getTime() - localNow;

  if (diff <= 0) return "00 hrs : 00 mns : 00 secs";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, "0")} hrs : ${minutes
    .toString()
    .padStart(2, "0")} mns : ${seconds.toString().padStart(2, "0")} secs`;
}

/* ======================
   🔹 NAV ELEMENTS
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

/* ======================
   🔹 NAVIGATION
====================== */
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
   🔹 SCHEDULE LOGIC
====================== */
function getNextScheduledSpawn(scheduleStr) {
  if (!scheduleStr) return null;
  const now = new Date();
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const schedules = scheduleStr.split(",").map(s => s.trim());
  let soonest = null;

  for (const entry of schedules) {
    const [dayStr, timeStr] = entry.split(" ");
    const dayIndex = daysOfWeek.findIndex(d => d.toLowerCase() === dayStr.toLowerCase());
    if (dayIndex === -1 || !timeStr) continue;

    const [hour, minute] = timeStr.split(":").map(Number);
    let candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);

    const diffDays = (dayIndex - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diffDays);
    if (candidate < now) candidate.setDate(candidate.getDate() + 7); // ✅ use < now

    if (!soonest || candidate < soonest) soonest = candidate;
  }
  return soonest;
}

/* ======================
   🔹 DASHBOARD RENDER
====================== */
async function fetchAndRenderBosses() {
  try {
    const snapshot = await get(ref(db, "bosses"));
    if (!snapshot.exists()) {
      dashboardCards.innerHTML = "<p>No bosses found</p>";
      return;
    }

    const bosses = [];
    snapshot.forEach(childSnap => {
      const b = childSnap.val();
      b._key = childSnap.key;
      let ts = Date.parse(b.nextSpawn);
      if (isNaN(ts) && typeof b.nextSpawn === "string") ts = Date.parse(b.nextSpawn.replace(" ", "T"));
      if (b.bossSchedule && !b.bossHour) {
        const nextDate = getNextScheduledSpawn(b.bossSchedule);
        ts = nextDate ? nextDate.getTime() : Infinity;
        b.nextSpawn = nextDate ? nextDate.toISOString() : b.nextSpawn;
      }
      b._ts = isNaN(ts) ? Infinity : ts;
      bosses.push(b);
    });

    bosses.sort((a, b) => a._ts - b._ts);

    const now = nowUTC();
    const today = now.getDate();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const groups = { soon: [], today: [], tomorrow: [], later: [] };

    bosses.forEach(b => {
      const nextDate = new Date(b._ts);
      const diff = nextDate - nowUTC();

      if (diff <= 10 * 60000 && diff > -5 * 60000) groups.soon.push(b);
      else if (nextDate.getDate() === today) groups.today.push(b);
      else if (nextDate.getDate() === tomorrow.getDate()) groups.tomorrow.push(b);
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
      toggle.style.transition = "transform 0.2s ease";
      header.appendChild(toggle);

      const grid = document.createElement("div");
      grid.className = "boss-grid";
      grid.style.margin = "10px auto";
      grid.style.padding = "0 10px";
      grid.style.overflow = "hidden";
      grid.style.transition = "max-height 0.4s ease, opacity 0.4s ease";
      grid.dataset.sectionColor = section.color;

      section.data.forEach(b => grid.appendChild(createBossCard(b, section.color)));

      header.addEventListener("click", () => {
        if (grid.classList.contains("animating")) return;
        grid.classList.add("animating");

        const isCollapsed = grid.classList.contains("collapsed");

        if (isCollapsed) {
          grid.classList.remove("collapsed");
          grid.style.display = "grid";
          const fullHeight = grid.scrollHeight + "px";
          grid.style.maxHeight = "0px";
          grid.offsetHeight;
          grid.style.maxHeight = fullHeight;
          grid.style.opacity = "1";
          toggle.style.transform = "rotate(0deg)";
          setTimeout(() => {
            grid.style.maxHeight = "none";
            grid.classList.remove("animating");
          }, 400);
        } else {
          const fullHeight = grid.scrollHeight + "px";
          grid.style.maxHeight = fullHeight;
          grid.offsetHeight;
          grid.style.maxHeight = "0px";
          grid.style.opacity = "0";
          toggle.style.transform = "rotate(-90deg)";
          setTimeout(() => {
            grid.classList.add("collapsed");
            grid.classList.remove("animating");
            grid.style.display = "none";
          }, 400);
        }
      });

      sectionContainer.appendChild(header);
      sectionContainer.appendChild(grid);
      dashboardCards.appendChild(sectionContainer);
    });

  } catch (err) {
    console.error("Error loading bosses:", err);
    dashboardCards.innerHTML = "<p>Error loading bosses</p>";
  }

  function createBossCard(b, sectionColor = "#007bff") {
    const card = document.createElement("div");
    card.className = "boss-tile";
    card.style.borderLeft = `6px solid ${sectionColor}`;

    card.addEventListener("mouseenter", () => (card.style.transform = "scale(1.03)"));
    card.addEventListener("mouseleave", () => (card.style.transform = "scale(1)"));

    const bossImageMap = {
      VENATUS: "img/venatus.png", VIORENT: "img/viorent.png", EGO: "img/ego.png",
      LIVERA: "img/livera_fool.png", ARANEO: "img/araneo.png", NEUTRO: "img/neutro_fool.png",
      SAPHIRUS: "img/saphirus.png", THYMELE: "img/thymele.png", UNDOMIEL: "img/undomiel.png",
      WANNITAS: "img/wannitas.png", DUPLICAN: "img/duplican.png", METUS: "img/metus_fool.png",
      AMENTIS: "img/amentis.png", CLEMANTIS: "img/clemantis.png", TITORE: "img/titore.png",
      GARETH: "img/gareth.png", LADYDALIA: "img/lady_dalia.png", GENAQULUES: "img/gen_aquleus.png",
      GENERALAQULES: "img/gen_aquleus.png", AURAQ: "img/auraq_fool.png", MILAVY: "img/milavy.png",
      CHAIFLOCK: "img/chaiflock.png", RODERICK: "img/roderick_fool.png", RINGOR: "img/ringor_fool.png",
      BENJI: "img/benji_fool.png", SHULIAR: "img/shuliar.png", LARBA: "img/larba_fool.png",
      GENAQULEUS: "img/gen_aquleus.png", BARON: "img/baron_fool.png",};

    const normalizedName = b.bossName?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "";
    const imgSrc = bossImageMap[normalizedName] || "img/default.png";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = b.bossName;
    img.className = "boss-tile-img";
    card.appendChild(img);

    const info = document.createElement("div");
    info.className = "boss-tile-info";
    card.appendChild(info);

    const guild = b.guild || "FFA";
    const guildTag = document.createElement("span");
    guildTag.textContent = guild;
    guildTag.className = `guild-badge ${guild}`;
    info.appendChild(guildTag);

    const title = document.createElement("h3");
    title.textContent = b.bossName || "Unknown";
    info.appendChild(title);

    const nextDate = b._ts !== Infinity ? new Date(b._ts) : null;
    const countdown = document.createElement("span");
    countdown.className = "countdown";
    info.appendChild(countdown);

    const spawnInfo = document.createElement("p");
    spawnInfo.innerHTML = `<span style="color:#666; font-weight:bold">Spawn:</span> <strong>${formatWithTimezone(new Date(b._ts))}</strong>`;
    info.appendChild(spawnInfo);

    if (nextDate) {
      // ✅ clear old interval if exists
      if (countdownTimers.has(b._key)) clearInterval(countdownTimers.get(b._key));

      const interval = setInterval(() => {
        const liveNextDate = new Date(b._ts);
        const diff = liveNextDate - nowUTC();
        const tenMin = 10 * 60000; // ✅ ADD THIS LINE

         // 🔔 DISCORD ADD — 10 MIN WARNING
        if (
          diff <= tenMin &&
          diff > tenMin - 1000 &&
          !b.warned10m
        ) {
          sendDiscordMessage(
            `@everyone ⚠️ **${b.bossName} spawning @ approximately 10 minutes!**`
          );
        }

        // // 🔔 DISCORD ADD — SPAWN PING
        // if (diff <= 0 && !b.spawnedPinged) {
        //   sendDiscordMessage(
        //     `@everyone 🔥 **${b.bossName} has spawned!**`
        //   );
        // }

        if (diff <= 0 && diff > -5 * 60000) {
          countdown.textContent = "SPAWNING NOW!";
          countdown.style.color = "red";
          card.style.borderLeftColor = "red";
        } else if (diff > 0 && diff <= 10 * 60000) {
          countdown.textContent = formatCountdown(liveNextDate);
          countdown.style.color = "#ff9900";
          card.style.borderLeftColor = "#ff9900";
        } else if (diff > 0) {
          countdown.textContent = formatCountdown(liveNextDate);
          countdown.style.color = sectionColor;
          card.style.borderLeftColor = sectionColor;
        } else {
          countdown.textContent = "Spawn Passed";
          countdown.style.color = "#777";
          card.style.borderLeftColor = "#777";
        }
      }, 1000);

      countdownTimers.set(b._key, interval);
    }

    return card;
  }
}

/* ======================
   🔹 INIT AFTER DOM READY
====================== */
window.addEventListener("DOMContentLoaded", () => {
  // Clear all existing intervals to prevent duplicates
  countdownTimers.forEach(clearInterval);
  countdownTimers.clear();

  fetchAndRenderBosses();
});

// On load
const savedOffset = localStorage.getItem("displayOffset");
if (savedOffset) {
  displayOffset = savedOffset === "local" ? "local" : parseFloat(savedOffset);
  timezoneSelect.value = savedOffset;
}

// On change
timezoneSelect.addEventListener("change", () => {
  const val = timezoneSelect.value;
  displayOffset = val === "local" ? "local" : parseFloat(val);
  localStorage.setItem("displayOffset", val);
  fetchAndRenderBosses();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) fetchAndRenderBosses();
});




