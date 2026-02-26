import { db } from "./firebase.js";
import { ref, push, set, update, remove, onValue, get } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export function initBossList() {

  let bossCache = {};
  const processedBosses = new Map();

  // -------------------------
  // DOM REFERENCES
  // -------------------------
  const bossForm = document.getElementById("bossForm");
  const bossTable = document.querySelector("#bossTable tbody");
  const bossModal = new bootstrap.Modal(document.getElementById("bossModal"));

  const bossName = document.getElementById("bossName");
  const bossHour = document.getElementById("bossHour");
  const lastKilled = document.getElementById("lastKilled");
  const lastKilledField = document.getElementById("lastKilledField");
  const nextSpawn = document.getElementById("nextSpawn");
  const editKey = document.getElementById("editKey");
  const hourGroup = document.getElementById("hourGroup");
  const scheduleGroup = document.getElementById("scheduleGroup");
  const bossSchedule = document.getElementById("bossSchedule");
  const spawnHourType = document.getElementById("spawnHourType");
  const spawnScheduleType = document.getElementById("spawnScheduleType");
  const estimatedDeath = document.getElementById("estimatedDeath");
  const bossLevel = document.getElementById("bossLevel");
  const btnRepopulate = document.getElementById("btnRepopulate");


  // ✅ Fixed schedule bosses list
  const fixedScheduleBosses = [
    { bossName: "CLEMANTIS", guild: "Faction", bossSchedule: "Monday 11:30, Thursday 19:00", lvl: "70", est: "3" },
    { bossName: "LIBITINA", guild: "Faction", bossSchedule: "Monday 21:00, Saturday 21:00", lvl: "130", est: "15" },
    { bossName: "RAKAJETH", guild: "Faction", bossSchedule: "Tuesday 22:00, Sunday 19:00", lvl: "130", est: "15" },
    { bossName: "SAPHIRUS", guild: "Faction", bossSchedule: "Sunday 17:00, Tuesday 11:30", lvl: "80", est: "4" },
    { bossName: "NEUTRO", guild: "Faction", bossSchedule: "Tuesday 19:00, Thursday 11:30", lvl: "80", est: "4" },
    { bossName: "THYMELE", guild: "Faction", bossSchedule: "Monday 19:00, Wednesday 11:30", lvl: "85", est: "5" },
    { bossName: "MILAVY", guild: "Faction", bossSchedule: "Saturday 15:00", lvl: "90", est: "5" },
    { bossName: "RINGOR", guild: "Faction", bossSchedule: "Saturday 17:00", lvl: "95", est: "5" },
    { bossName: "RODERICK", guild: "Faction", bossSchedule: "Friday 19:00", lvl: "95", est: "5" },
    { bossName: "AURAQ", guild: "Faction", bossSchedule: "Friday 22:00, Wednesday 21:00", lvl: "100", est: "5" },
    { bossName: "CHAIFLOCK", guild: "Faction", bossSchedule: "Saturday 22:00", lvl: "120", est: "5" },
    { bossName: "BENJI", guild: "Faction", bossSchedule: "Sunday 21:00", lvl: "120", est: "10" },
    { bossName: "TUMIER", guild: "Faction", bossSchedule: "Sunday 19:00", lvl: "140", est: "20" },
  ];

  // -------------------------
  // UTILITIES
  // -------------------------

  function isSameWeek(date) {
    const now = new Date();

    // Start of this week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0,0,0,0);
    startOfWeek.setDate(now.getDate() - now.getDay());

    // End of this week (Saturday 23:59:59)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23,59,59,999);

    return date >= startOfWeek && date <= endOfWeek;
  }

  // ✅ Calculate next spawn time
  function calcNextSpawn() {
    const isHourBased = spawnHourType.checked;
    const isScheduleBased = spawnScheduleType.checked;
    const lastKilledVal = lastKilled.value;

    if (isHourBased) {
      const hours = parseFloat(bossHour.value);
      if (hours && lastKilledVal) {
        const d = new Date(lastKilledVal);
        d.setHours(d.getHours() + hours);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        nextSpawn.value = local;
      }
    } else if (isScheduleBased) {
      const schedule = bossSchedule.value;
      if (!schedule) return;
      const next = getNextScheduledSpawn(schedule);
      if (next) {
        const local = new Date(next.getTime() - next.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        nextSpawn.value = local;
      }
    }
  }

  function toDatetimeLocalInput(stored) {
    if (!stored) return "";
    const d = new Date(stored);
    if (isNaN(d)) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getNextScheduledSpawn(scheduleStr) {
    if (!scheduleStr) return null;

    const now = new Date();
    const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const schedules = scheduleStr.split(",").map(s => s.trim());
    let soonest = null;

    for (const entry of schedules) {
      const [dayStr, timeStr] = entry.split(" ");
      if (!dayStr || !timeStr) continue;

      const dayIndex = days.findIndex(d => d.toLowerCase() === dayStr.toLowerCase());
      if (dayIndex === -1) continue;

      const [hour, minute] = timeStr.split(":").map(Number);

      let candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);

      const diff = (dayIndex - candidate.getDay() + 7) % 7;
      candidate.setDate(candidate.getDate() + diff);

      if (candidate < now) candidate.setDate(candidate.getDate() + 7);
      if (!soonest || candidate < soonest) soonest = candidate;
    }

    return soonest;
  }

  // -------------------------
  // FIREBASE LISTENER
  // -------------------------

  onValue(ref(db, "bosses"), snapshot => {
    bossCache = {};
    const bosses = [];

    snapshot.forEach(child => {
      const key = child.key;
      const b = child.val();
      b._key = key;

      const ts = Date.parse(b.nextSpawn);
      b._ts = isNaN(ts) ? Infinity : ts;

      bossCache[key] = b;
      bosses.push(b);
    });

    bosses.sort((a, b) => a._ts - b._ts);
    renderBossTable(bosses);
  });

  // -------------------------
  // TABLE RENDER
  // -------------------------

  function renderBossTable(bosses) {
    bossTable.innerHTML = "";

    bosses.forEach(b => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${b.bossName || "Unknown"}</td>
        <td><span class="badge bg-secondary">${b.guild || "Faction"}</span></td>
        <td>${b.bossHour && b.bossHour !== "null" ? b.bossHour + "h" : b.bossSchedule || "--"}</td>
        <td>${b.lastKilled || "--"}</td>
        <td>${b.nextSpawn || "--"}</td>
        <td>
          <button class="btn btn-info btn-sm edit-btn" data-key="${b._key}">Edit</button>
          <button class="btn btn-warning btn-sm reset-btn" data-key="${b._key}">Reset</button>
          <button class="btn btn-danger btn-sm delete-btn" data-key="${b._key}">Delete</button>
        </td>
      `;
      bossTable.appendChild(tr);
    });
  }

  // -------------------------
  // GLOBAL CLICK HANDLER (ONE LISTENER ONLY)
  // -------------------------

  document.addEventListener("click", async (e) => {

    // DELETE
    if (e.target.classList.contains("delete-btn")) {
      const key = e.target.dataset.key;
      if (!confirm("Delete this boss?")) return;
      await remove(ref(db, "bosses/" + key));
      return;
    }

    // RESET
    if (e.target.classList.contains("reset-btn")) {
      const key = e.target.dataset.key;
      const snap = await get(ref(db, "bosses/" + key));
      if (!snap.exists()) return alert("Boss not found");

      const entry = snap.val();
      if (!confirm(`Reset ${entry.bossName}?`)) return;

      const now = new Date();
      let nextSpawnTime = null;

      if (entry.bossHour && entry.bossHour !== "null") {
        const hours = Number(entry.bossHour);
        nextSpawnTime = new Date(now.getTime() + hours * 3600000);
      } else if (entry.bossSchedule) {
        nextSpawnTime = getNextScheduledSpawn(entry.bossSchedule);
      }

      if (!nextSpawnTime) return alert("Cannot calculate next spawn");

      await update(ref(db, "bosses/" + key), {
        lastKilled: now.toISOString(),
        nextSpawn: nextSpawnTime.toISOString(),
        warned10m: false,
        spawnedPinged: false
      });

      return;
    }

    // EDIT
    if (e.target.classList.contains("edit-btn")) {
      const key = e.target.dataset.key;
      const snap = await get(ref(db, "bosses/" + key));
      if (!snap.exists()) return alert("Boss not found");

      const b = snap.val();
      editKey.value = key;

      bossName.value = b.bossName || "";
      bossLevel.value = b.lvl || "";
      estimatedDeath.value = b.est || "";
      document.getElementById("guild").value = b.guild || "Faction";

      spawnHourType.checked = b.bossHour && b.bossHour !== "null";
      spawnScheduleType.checked = !spawnHourType.checked;

      bossHour.value = b.bossHour !== "null" ? b.bossHour : "";
      bossSchedule.value = b.bossSchedule !== "null" ? b.bossSchedule : "";

      lastKilled.value = toDatetimeLocalInput(b.lastKilled);
      nextSpawn.value = toDatetimeLocalInput(b.nextSpawn);

      updateSpawnTypeUI();
      bossModal.show();
    }

    if (btnRepopulate) {
      btnRepopulate.addEventListener("click", handleRepopulate);
    }

  });

  // -------------------------
  // FORM SUBMIT
  // -------------------------

  bossForm.addEventListener("submit", async e => {
    e.preventDefault();

    const entry = {
      bossName: bossName.value.trim().toUpperCase(),
      bossHour: spawnHourType.checked ? bossHour.value : "null",
      bossSchedule: spawnScheduleType.checked ? bossSchedule.value : "null",
      lastKilled: lastKilled.value,
      nextSpawn: nextSpawn.value,
      est: estimatedDeath.value,
      lvl: bossLevel.value,
      guild: document.getElementById("guild").value
    };

    const key = editKey.value;
    if (key) {
      await update(ref(db, "bosses/" + key), entry);
    } else {
      await set(push(ref(db, "bosses")), entry);
    }

    bossForm.reset();
    editKey.value = "";
    bossModal.hide();
  });

  // -------------------------
  // MONITOR (CACHE BASED)
  // -------------------------

  function monitorBosses() {
    const now = Date.now();

    for (const key in bossCache) {
      const boss = bossCache[key];
      const nextTime = Date.parse(boss.nextSpawn);
      if (isNaN(nextTime)) continue;

      const diff = now - nextTime;

      if (diff >= -10000 && diff <= 60000) {
        autoResetOrDeleteBoss(boss, key);
      }
    }
  }

  async function handleRepopulate() {

    if (!confirm("♻ Do you want to repopulate this week's fixed-schedule bosses?"))
      return;

    btnRepopulate.disabled = true;
    const originalText = btnRepopulate.innerHTML;
    btnRepopulate.innerHTML = "⏳ Repopulating...";

    try {
      const bossesRef = ref(db, "bosses");
      const snapshot = await get(bossesRef);
      const existing = new Set();

      if (snapshot.exists()) {
        snapshot.forEach(child => {
          const b = child.val();
          if (b.nextSpawn) {
            const key = `${b.bossName}_${b.nextSpawn}`.toUpperCase();
            existing.add(key);
          }
        });
      }

      let added = 0;

      for (const b of fixedScheduleBosses) {

        const schedules = b.bossSchedule.split(",").map(s => s.trim());

        for (const scheduleEntry of schedules) {

          const nextSpawn = getNextScheduledSpawn(scheduleEntry);
          if (!nextSpawn) continue;

          // ✅ Only this week
          if (!isSameWeek(nextSpawn)) continue;

          const uniqueKey =
            `${b.bossName}_${nextSpawn.toISOString()}`.toUpperCase();

          if (!existing.has(uniqueKey)) {

            await push(bossesRef, {
              bossName: b.bossName,
              guild: b.guild,
              lvl: b.lvl,
              est: b.est,
              bossSchedule: scheduleEntry,
              nextSpawn: nextSpawn.toISOString(),
              bossHour: "null",
              lastKilled: "",
              warned10m: false,
              spawnedPinged: false,
              cycleReset: false
            });

            existing.add(uniqueKey);
            added++;
          }
        }
      }

      alert(
        added > 0
          ? `✅ ${added} new boss${added > 1 ? "es" : ""} added successfully.`
          : "✅ All fixed-schedule bosses already exist for this week."
      );

    } catch (err) {
      console.error("⚠️ Repopulate error:", err);
      alert("⚠️ Something went wrong while repopulating!");
    } finally {
      btnRepopulate.disabled = false;
      btnRepopulate.innerHTML = originalText;
    }
  }

  async function autoResetOrDeleteBoss(entry, key) {
    const lastProc = processedBosses.get(key);
    const now = Date.now();
    if (lastProc && now - lastProc < 120000) return;

    processedBosses.set(key, now);

    if (entry.bossSchedule && (!entry.bossHour || entry.bossHour === "null")) {
      await remove(ref(db, "bosses/" + key));
    }
  }
  
  setInterval(monitorBosses, 5000);

  // -------------------------
  // UI TOGGLE
  // -------------------------

  bossHour.addEventListener("input", calcNextSpawn);
  bossSchedule.addEventListener("change", calcNextSpawn);
  lastKilled.addEventListener("input", calcNextSpawn);
  spawnHourType.addEventListener("change", calcNextSpawn);
  spawnScheduleType.addEventListener("change", calcNextSpawn);

  function updateSpawnTypeUI() {
    hourGroup.style.display = spawnHourType.checked ? "block" : "none";
    lastKilledField.style.display = spawnHourType.checked ? "block" : "none";
    scheduleGroup.style.display = spawnScheduleType.checked ? "block" : "none";
  }

  spawnHourType.addEventListener("change", updateSpawnTypeUI);
  spawnScheduleType.addEventListener("change", updateSpawnTypeUI);
  window.addEventListener("load", () => {
    handleRepopulate();
  });
  updateSpawnTypeUI();
}

