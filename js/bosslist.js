import { db } from "./firebase.js";
import { ref, push, set, update, remove, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export function initBossList() {
  window.onerror = (msg, src, line, col, err) => {
    console.error("⚠️ JS Error:", msg, "at", line, ":", col, err);
  };

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

  // ✅ Fixed schedule bosses list
  const fixedScheduleBosses = [
    { bossName: "CLEMANTIS", guild: "Faction", bossSchedule: "Monday 11:30, Thursday 19:00" },
    { bossName: "LIBITINA", guild: "Faction", bossSchedule: "Monday 21:00, Saturday 21:00" },
    { bossName: "RAKAJETH", guild: "Faction", bossSchedule: "Tuesday 22:00, Sunday 19:00" },
    { bossName: "SAPHIRUS", guild: "Faction", bossSchedule: "Sunday 17:00, Tuesday 11:30" },
    { bossName: "NEUTRO", guild: "Faction", bossSchedule: "Tuesday 19:00, Thursday 11:30" },
    { bossName: "THYMELE", guild: "Faction", bossSchedule: "Monday 19:00, Wednesday 11:30" },
    { bossName: "MILAVY", guild: "Faction", bossSchedule: "Saturday 15:00" },
    { bossName: "RINGOR", guild: "Faction", bossSchedule: "Saturday 17:00" },
    { bossName: "RODERICK", guild: "Faction", bossSchedule: "Friday 19:00" },
    { bossName: "AURAQ", guild: "Faction", bossSchedule: "Friday 22:00, Wednesday 21:00" },
    { bossName: "CHAIFLOCK", guild: "Faction", bossSchedule: "Saturday 22:00" },
    { bossName: "BENJI", guild: "Faction", bossSchedule: "Sunday 21:00" },
  ];

  // ✅ Convert timestamps for form fields
  function toDatetimeLocalInput(stored) {
    if (!stored) return "";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stored)) return stored;
    const d = new Date(stored);
    if (isNaN(d)) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  bossHour.addEventListener("input", calcNextSpawn);
  bossSchedule.addEventListener("change", calcNextSpawn);
  lastKilled.addEventListener("input", calcNextSpawn);
  spawnHourType.addEventListener("change", calcNextSpawn);
  spawnScheduleType.addEventListener("change", calcNextSpawn);

  // ✅ Get next weekly schedule
  function getNextScheduledSpawn(scheduleStr) {
    if (!scheduleStr) return null;

    const now = new Date();
    const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const schedules = scheduleStr.split(",").map(s => s.trim());
    let soonest = null;

    for (const entry of schedules) {
      const parts = entry.split(/\s+/);
      const dayStr = parts[0];
      const timeStr = parts[1];

      const dayIndex = daysOfWeek.findIndex(
        d => d.toLowerCase() === dayStr.toLowerCase()
      );
      if (dayIndex === -1 || !timeStr) continue;

      const [hour, minute] = timeStr.split(":").map(Number);
      let candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);

      const diffDays = (dayIndex - candidate.getDay() + 7) % 7;
      candidate.setDate(candidate.getDate() + diffDays);

      if (candidate < now) candidate.setDate(candidate.getDate() + 7);

      if (!soonest || candidate < soonest) {
        soonest = candidate;
      }
    }

    return soonest;
  }

  // ✅ Boss processing tracker
  const processedBosses = new Map();

  // ✅ Auto-reset or delete logic
  async function autoResetOrDeleteBoss(entry, key) {
    if (!entry.nextSpawn) return;
    const nextSpawn = new Date(entry.nextSpawn);
    if (isNaN(nextSpawn)) return;

    const now = new Date();
    const diffMs = now - nextSpawn;

    const lastProc = processedBosses.get(key);
    if (lastProc && now - lastProc < 120000) return;

    // ±45 seconds tolerance
    if (diffMs >= -10000 && diffMs <= 60000) {
      processedBosses.set(key, now);
      const bossRef = ref(db, "bosses/" + key);

      // Hour-based boss → reset spawn timer
      if (entry.bossHour && !entry.bossSchedule) {
        // const newLastKilled = new Date();
        // const nextSpawnTime = new Date(newLastKilled.getTime() + entry.bossHour * 60 * 60 * 1000);

        // await update(bossRef, {
        //   lastKilled: newLastKilled.toISOString(),
        //   nextSpawn: nextSpawnTime.toISOString(),
        // });
        // console.log(`✅ Auto-reset done for ${entry.bossName}`);
      }

      // Fixed-schedule boss → delete entry after spawn
      else if (entry.bossSchedule && !entry.bossHour) {
        await remove(bossRef);
        console.log(`🗑️ Auto-deleted schedule boss "${entry.bossName}" after spawn.`);
      }

      // Force refresh
      setTimeout(monitorBosses, 2000);
    }
  }

  // ✅ Weekly repopulation
  async function repopulateWeeklyScheduleBosses(force = false) {
    try {
      const now = new Date();
      const day = now.getDay();
      const hour = now.getHours();

      if (!force && !(day === 1 && hour >= 1)) {
        console.log("⏸️ Not Monday 1AM yet — skipping repopulation.");
        return;
      }

      const bossesRef = ref(db, "bosses");
      const snapshot = await get(bossesRef);
      const existing = [];

      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const b = child.val();
          if (b.bossSchedule) existing.push(`${b.bossName}_${b.bossSchedule}`);
        });
      }

      let added = 0;
      for (const b of fixedScheduleBosses) {
        const key = `${b.bossName}_${b.bossSchedule}`;
        if (!existing.includes(key)) {
          const next = getNextScheduledSpawn(b.bossSchedule);
          await push(bossesRef, {
            bossName: b.bossName,
            guild: b.guild,
            bossSchedule: b.bossSchedule,
            nextSpawn: next ? next.toISOString() : "",
            warned10m: false,
            spawnedPinged: false,
            cycleReset: false
          });
          added++;
        }
      }

      console.log(added > 0 ? `🆕 Repopulated ${added} bosses.` : "✅ All fixed bosses already exist.");
    } catch (err) {
      console.error("⚠️ Repopulation error:", err);
    }
  }

  // ✅ Toggle between hour/schedule mode
  function updateSpawnTypeUI() {
    if (spawnHourType.checked) {
      hourGroup.style.display = "block";
      lastKilledField.style.display = "block";
      scheduleGroup.style.display = "none";
      bossSchedule.value = "";
    } else {
      lastKilledField.style.display = "none";
      hourGroup.style.display = "none";
      scheduleGroup.style.display = "block";
      bossHour.value = "";
    }
    calcNextSpawn();
  }
  spawnHourType.addEventListener("change", updateSpawnTypeUI);
  spawnScheduleType.addEventListener("change", updateSpawnTypeUI);
  updateSpawnTypeUI();

  // ✅ Submit handler
  bossForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const guildVal = document.getElementById("guild").value || "FACTION";
    const entry = {
      bossName: bossName.value.trim().toUpperCase(),
      bossHour: spawnHourType.checked ? bossHour.value : "",
      bossSchedule: spawnScheduleType.checked ? bossSchedule.value : "",
      lastKilled: lastKilled.value,
      nextSpawn: nextSpawn.value,
      guild: guildVal,
    };

    const key = editKey.value;
    if (key) await update(ref(db, "bosses/" + key), entry);
    else await set(push(ref(db, "bosses")), entry);

    bossForm.reset();
    nextSpawn.value = "";
    editKey.value = "";
    bossModal.hide();
  });

  // ✅ Clear form button
  document.getElementById("btnAdd").addEventListener("click", clearBossForm);
  function clearBossForm() {
    bossForm.reset();
    bossName.focus();
    editKey.value = ""; // ✅ reset edit mode
    nextSpawn.value = "";
    console.log("Form cleared successfully!");
  }

  // ✅ Populate table
  onValue(ref(db, "bosses"), (snapshot) => {
    bossTable.innerHTML = "";
    const bosses = [];

    snapshot.forEach((child) => {
      const key = child.key;
      const b = child.val();
      b._key = key;

      let ts = Date.parse(b.nextSpawn);
      if (b.bossSchedule && !b.bossHour) {
        const nextDate = getNextScheduledSpawn(b.bossSchedule);
        ts = nextDate ? nextDate.getTime() : Infinity;
        b.nextSpawn = nextDate ? nextDate.toLocaleString() : "--";
      }

      b._ts = isNaN(ts) ? Infinity : ts;
      bosses.push(b);

      if (b.nextSpawn && b.nextSpawn !== "--") autoResetOrDeleteBoss(b, key);
    });

    bosses.sort((a, b) => a._ts - b._ts);

    bosses.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${b.bossName || "Unknown"}</td>
        <td><span class="badge bg-secondary">${b.guild || "FFA"}</span></td>
        <td>${b.bossHour || b.bossSchedule || "--"}</td>
        <td>${b.lastKilled || "--"}</td>
        <td>${b.nextSpawn || "--"}</td>
        <td>
          <button class="btn btn-info btn-sm edit-btn" data-key="${b._key}">Edit</button>
          <button class="btn btn-warning btn-sm reset-btn" data-key="${b._key}">Reset</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${b._key}">Delete</button>
        </td>`;
      bossTable.appendChild(tr);
    });

    // ✅ Manual repopulate button (safe duplicate-checked version)
    const btnRepopulate = document.getElementById("btnRepopulate");
    if (btnRepopulate) {
      btnRepopulate.addEventListener("click", async () => {
        if (!confirm("♻ Do you want to repopulate all fixed-schedule bosses now?")) return;

        btnRepopulate.disabled = true;
        const originalText = btnRepopulate.innerHTML;
        btnRepopulate.innerHTML = "⏳ Repopulating...";

        try {
          const bossesRef = ref(db, "bosses");
          const snapshot = await get(bossesRef);
          const existing = [];

          if (snapshot.exists()) {
            snapshot.forEach((child) => {
              const b = child.val();
              if (b.bossSchedule)
                existing.push(`${b.bossName}_${b.bossSchedule}`.toUpperCase());
            });
          }

          let added = 0;
          for (const b of fixedScheduleBosses) {
            const key = `${b.bossName}_${b.bossSchedule}`.toUpperCase();
            if (!existing.includes(key)) {
              const next = getNextScheduledSpawn(b.bossSchedule);
              await push(bossesRef, {
                bossName: b.bossName,
                guild: b.guild,
                bossHour: 'null',
                bossSchedule: b.bossSchedule,
                nextSpawn: next ? next.toISOString() : "",
                bossHour: "",
                lastKilled: "",
              });
              added++;
            }
          }

          alert(
            added > 0
              ? `✅ ${added} new boss${added > 1 ? "es" : ""} added successfully.`
              : `✅ All fixed-schedule bosses already exist — no changes made.`
          );

          monitorBosses();
        } catch (err) {
          console.error("⚠️ Repopulate error:", err);
          alert("⚠️ Something went wrong while repopulating!");
        } finally {
          btnRepopulate.disabled = false;
          btnRepopulate.innerHTML = originalText;
        }
      });
    }


    // ✅ Edit button
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.key;
        const bossRef = ref(db, "bosses/" + key);
        const snap = await get(bossRef);
        if (!snap.exists()) return alert("⚠️ Boss not found!");
        const b = snap.val();

        bossName.value = b.bossName || "";
        bossHour.value = b.bossHour || "null";
        lastKilled.value = toDatetimeLocalInput(b.lastKilled);
        nextSpawn.value = toDatetimeLocalInput(b.nextSpawn);
        document.getElementById("guild").value = b.guild || "FFA";
        editKey.value = key;

        bossModal.show();
      });
    });

    // ✅ Reset button
    document.querySelectorAll(".reset-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.key;
        const bossRef = ref(db, "bosses/" + key);
        const snap = await get(bossRef);
        if (!snap.exists()) return alert("⚠️ Boss not found!");

        const entry = snap.val();
        if (!confirm(`Reset ${entry.bossName}?`)) return;

        const now = new Date();
        const nextSpawnTime = new Date(now.getTime() + entry.bossHour * 60 * 60 * 1000);
        await update(bossRef, {
          lastKilled: now.toISOString(),
          nextSpawn: nextSpawnTime.toISOString(),
          spawnedPinged: false,
          bossSchedule: 'null',
          warned10m: false,
          spawnedPinged: false,
          cycleReset: true,
        });

        monitorBosses();
      });
    });

    // ✅ Delete button
    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this boss?")) {
          await remove(ref(db, "bosses/" + btn.dataset.id));
          monitorBosses();
        }
      });
    });
  });

  // ✅ Continuous monitor
  async function monitorBosses() {
    const bossesRef = ref(db, "bosses");
    const snapshot = await get(bossesRef);
    if (!snapshot.exists()) return;

    snapshot.forEach((child) => {
      const key = child.key;
      const b = child.val();
      autoResetOrDeleteBoss(b, key);
    });
  }

  // Run every 10 seconds
  setInterval(monitorBosses, 10000);
  window.addEventListener("load", () => {
    repopulateWeeklyScheduleBosses();
    monitorBosses();
  });

  // Expose manual repopulate
  window.repopulateWeeklyScheduleBosses = repopulateWeeklyScheduleBosses;
}










