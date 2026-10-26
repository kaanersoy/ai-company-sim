// Top-down pixel office. Characters: Kenney "RPG Urban Pack" (CC0), assets/tilemap.png. Everything else is drawn in code.
const $ = (id) => document.getElementById(id);
const W = 400, H = 224, TILE = 17, CHAR_COL = 23, CHAR_ROWS = 3, CHARS = 6;
const DIR = { down: 0, up: 1, left: 2, right: 3 };
const cv = $("cv"), ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = false;
const sheet = new Image();
sheet.src = "/assets/tilemap.png";

// ---------- layout ----------
const SLOTS = [50, 125, 200, 275, 350].map((x) => ({ x, y: 128 }));
const MANAGER_HOME = { x: 200, y: 62 };
const DOOR = { x: -20, y: 150 };

const NAMES = ["Alex", "Mia", "Noah", "Emma", "Liam", "Zoe", "Ben", "Chloe", "Jack", "Nora"];
const TITLES = { engineer: "Engineer", marketing: "Marketing", designer: "Designer", manager: "CEO", customer: "Customer" };
const names = new Map(); // id -> { name, title }
let nameIdx = 0;
function identify(id, role) {
  if (!names.has(id)) names.set(id, id === "manager" ? { name: "Claire", title: "CEO" }
    : { name: NAMES[nameIdx++ % NAMES.length], title: TITLES[role] ?? role });
  return names.get(id);
}
const nm = (id) => names.get(id)?.name ?? id;
const people = new Map(); // id -> person
let nextCharIdx = 1;
const CUSTOMER_CH = [5, 3, 2, 4, 1];
let customerIds = [];   // from the server hello: stable sprite per customer
const charFor = (id, role) => (id === "manager" ? 0 : role === "customer" ? CUSTOMER_CH[Math.max(0, customerIds.indexOf(id)) % CUSTOMER_CH.length] : 1 + ((nextCharIdx++ - 1) % 4));

function addPerson(id, role, home, opts = {}) {
  if (people.has(id)) return people.get(id);
  identify(id, opts.title ?? role);
  const p = { id, role, home, x: home.x, y: home.y, dir: "down", ch: charFor(id, role), moving: false, target: null, resolve: null, bubble: null, speed: 1 };
  if (opts.fromDoor) { p.x = DOOR.x; p.y = DOOR.y; }
  people.set(id, p);
  return p;
}

// ---------- animation helpers ----------
let speedMul = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speedMul));
function walkTo(p, x, y) {
  return new Promise((res) => { p.target = { x, y }; p.resolve = res; });
}

function step(dt) {
  for (const p of people.values()) {
    if (!p.target) { p.moving = false; continue; }
    const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy);
    const sp = 70 * speedMul * dt;
    if (d <= sp) {
      p.x = p.target.x; p.y = p.target.y; p.target = null; p.moving = false;
      p.resolve?.(); p.resolve = null;
    } else {
      p.x += (dx / d) * sp; p.y += (dy / d) * sp; p.moving = true;
      p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
  }
}

// ---------- time of day ----------
// The engine only has whole days, so the clock is derived from how far the day's events have progressed.
// `clock` is absolute hours (24 per day) and eases toward `clockTarget`.
let clock = 6, clockTarget = 6;
const KEYS = [[0, "#0a0e27", "#16204a"], [5, "#0f1538", "#2b2f6a"], [6.2, "#4a5a9a", "#ffb38a"], [7.5, "#7fb8ee", "#ffd9a8"],
  [10, "#6ec6ff", "#b8e6ff"], [16, "#6ec6ff", "#b8e6ff"], [17.5, "#6f8fd0", "#ffc27a"], [18.5, "#b0507a", "#ff8a4a"],
  [19.5, "#3a2f6a", "#c0507a"], [21, "#0f1538", "#2b2f6a"], [24, "#0a0e27", "#16204a"]];
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = rgb(a), B = rgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
function skyAt(h) {
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
  const [h0, t0, b0] = KEYS[i], [h1, t1, b1] = KEYS[i + 1], f = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  const top = mix(t0, t1, f), bot = mix(b0, b1, f);
  const [r, g, b] = rgb(top);
  const night = Math.min(1, Math.max(0, 1 - (r + g + b) / 330));
  return { top, bot, night };
}
const STARS = [[3, 2], [9, 5], [16, 1], [22, 4], [25, 8], [6, 9], [13, 3], [19, 7]];
const SKYLINE = [[0, 5, 4], [5, 4, 7], [9, 6, 5], [15, 4, 8], [19, 5, 4], [24, 4, 6]];
function periodOf(h) {
  return h < 5 ? "Night" : h < 7 ? "Sunrise" : h < 11 ? "Morning" : h < 14 ? "Noon" : h < 17.5 ? "Afternoon" : h < 20 ? "Sunset" : "Night";
}
function setTime(e, counts) {
  const base = 24 * (Math.max(1, e.day) - 1);
  const c = (k) => (counts[k] = (counts[k] ?? 0) + 1);
  let h = null;
  switch (e.type) {
    case "daily_retro": case "plan": h = 6.5; break;
    case "daily_reply": h = 7.5; break;
    case "work": h = 9 + Math.min(3.5, c("w") * 0.7); break;
    case "message": h = 13 + Math.min(2.5, c("m") * 0.5); break;
    case "hire": case "fire": case "spend": case "set_price": h = 8; break;
    case "salary": h = 15.6; break;
    case "customer_review": h = 16.2; break;
    case "subscription": h = 16.8; break;
    case "day_end": h = 17.5; break;
    default: break;
  }
  if (h !== null) clockTarget = Math.max(clockTarget, base + h);
}
function tickClock(dt) {
  const d = clockTarget - clock;
  if (d > 0) clock += Math.min(d, Math.max(d * dt * 2, dt * 1.5 * speedMul));
}

// ---------- drawing ----------
function drawFloor() {
  for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) {
    ctx.fillStyle = ((x + y) / 16) % 2 ? "#b9a98a" : "#c4b594";
    ctx.fillRect(x, y, 16, 16);
  }
  // back wall
  ctx.fillStyle = "#6b7a99"; ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = "#4b5875"; ctx.fillRect(0, 30, W, 4);
  ctx.fillStyle = "#2b3347"; ctx.fillRect(0, 34, W, 2);
  const hh = clock % 24, sky = skyAt(hh);
  for (let x = 20; x < W - 20; x += 64) { // windows: the sky shows the time of day
    ctx.fillStyle = "#2b3347"; ctx.fillRect(x - 1, 6, 30, 20);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, 7, 28, 18); ctx.clip();
    for (let i = 0; i < 9; i++) { // vertical gradient in 2px bands
      ctx.fillStyle = mix(sky.top, sky.bot, i / 8); ctx.fillRect(x, 7 + i * 2, 28, 2);
    }
    if (sky.night > 0.3) { // stars
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, (sky.night - 0.3) * 1.5)})`;
      for (const [sx, sy] of STARS) ctx.fillRect(x + sx, 7 + sy, 1, 1);
    }
    const sunP = (hh - 5.5) / 13, moonH = hh < 12 ? hh + 24 : hh, moonP = (moonH - 17.5) / 13;
    if (sunP > -0.05 && sunP < 1.05) { // sun crosses the whole wall
      const sxp = 20 + sunP * (W - 40), syp = 25 - Math.sin(Math.PI * Math.min(1, Math.max(0, sunP))) * 15;
      const low = Math.sin(Math.PI * Math.min(1, Math.max(0, sunP))) < 0.35;
      ctx.fillStyle = low ? "#ff7a2f" : "#ffe45c"; ctx.fillRect(sxp - 3 - x, syp - 3, 6, 6);
      ctx.fillStyle = low ? "#ffb066" : "#fff6b0"; ctx.fillRect(sxp - 2 - x, syp - 2, 4, 4);
    }
    if (moonP > -0.05 && moonP < 1.05) {
      const sxp = 20 + moonP * (W - 40), syp = 25 - Math.sin(Math.PI * Math.min(1, Math.max(0, moonP))) * 15;
      ctx.fillStyle = "#eef2ff"; ctx.fillRect(sxp - 3 - x, syp - 3, 6, 6);
      ctx.fillStyle = sky.top; ctx.fillRect(sxp - 1 - x, syp - 3, 4, 4); // crescent
    }
    // skyline
    ctx.fillStyle = mix(sky.bot, "#1b2236", 0.7);
    for (const [bx, bw, bh] of SKYLINE) ctx.fillRect(x + bx, 25 - bh, bw, bh);
    ctx.restore();
    ctx.fillStyle = "#2b3347"; ctx.fillRect(x + 13, 7, 2, 18);
  }
  // rug between manager and the desks
  ctx.fillStyle = "#7a3b3b"; ctx.fillRect(120, 92, 160, 20);
  ctx.fillStyle = "#964848"; ctx.fillRect(122, 94, 156, 16);
  // door
  ctx.fillStyle = "#5a3d2a"; ctx.fillRect(0, 138, 5, 28);
  ctx.fillStyle = "#e6c15a"; ctx.fillRect(1, 150, 2, 2);
}

function desk(x, y, wide = 40) {
  ctx.fillStyle = "#00000033"; ctx.fillRect(x - wide / 2 + 2, y + 14, wide, 4);
  ctx.fillStyle = "#6b4a2e"; ctx.fillRect(x - wide / 2, y, wide, 14);
  ctx.fillStyle = "#8a6240"; ctx.fillRect(x - wide / 2, y, wide, 3);
  ctx.fillStyle = "#3a2817"; ctx.fillRect(x - wide / 2, y + 13, wide, 1);
  // monitor + keyboard
  ctx.fillStyle = "#1c2230"; ctx.fillRect(x - 7, y - 9, 14, 9);
  ctx.fillStyle = "#4aa3ff"; ctx.fillRect(x - 6, y - 8, 12, 6);
  ctx.fillStyle = "#cfd6e4"; ctx.fillRect(x - 6, y + 5, 12, 3);
}

function plant(x, y) {
  ctx.fillStyle = "#8b5a2b"; ctx.fillRect(x - 4, y + 6, 8, 6);
  ctx.fillStyle = "#2f8f4e"; ctx.fillRect(x - 6, y - 2, 12, 9);
  ctx.fillStyle = "#49b86a"; ctx.fillRect(x - 4, y - 5, 8, 6);
}

function sprite(p) {
  const frame = p.moving ? 1 + (Math.floor(performance.now() / 160) % 2) : 0;
  const sx = (CHAR_COL + DIR[p.dir]) * TILE, sy = (p.ch * CHAR_ROWS + frame) * TILE;
  ctx.fillStyle = "#00000033"; ctx.fillRect(Math.round(p.x) - 5, Math.round(p.y) + 14, 10, 2);
  ctx.drawImage(sheet, sx, sy, 16, 16, Math.round(p.x) - 8, Math.round(p.y), 16, 16);
}

function label(p) {
  const { name, title } = names.get(p.id) ?? { name: p.id, title: "" };
  ctx.textAlign = "center";
  ctx.font = "7px monospace";
  const w1 = ctx.measureText(name).width;
  ctx.font = "5px monospace";
  const w2 = title ? ctx.measureText(title).width : 0;
  const w = Math.max(w1, w2) + 4, x = Math.round(p.x), y = Math.round(p.y) + 17;
  ctx.fillStyle = "#000a"; ctx.fillRect(Math.round(x - w / 2), y, Math.round(w), title ? 14 : 9);
  ctx.font = "7px monospace"; ctx.fillStyle = "#fff"; ctx.fillText(name, x, y + 7);
  if (title) { ctx.font = "5px monospace"; ctx.fillStyle = "#b8c0d0"; ctx.fillText(title, x, y + 13); }
}

function render() {
  if (!sheet.complete) return;
  drawFloor();
  plant(14, 50); plant(386, 118);
  desk(MANAGER_HOME.x, MANAGER_HOME.y + 10, 56);
  for (const p of people.values()) if (p.role === "employee") desk(p.home.x, p.home.y + 10);
  const list = [...people.values()].sort((a, b) => a.y - b.y);
  for (const p of list) if (p.role !== "customer") sprite(p);
  for (const p of list) if (p.role === "customer") sprite(p);
  const hh = clock % 24, sky = skyAt(hh); // room light follows the sky
  if (sky.night > 0.02) { ctx.fillStyle = `rgba(10,20,70,${(sky.night * 0.4).toFixed(3)})`; ctx.fillRect(0, 36, W, H - 36); }
  const dusk = Math.max(0, 1 - Math.abs(hh - 18.3) / 1.6, 1 - Math.abs(hh - 6.3) / 1.2);
  if (dusk > 0) { ctx.fillStyle = `rgba(255,140,60,${(dusk * 0.12).toFixed(3)})`; ctx.fillRect(0, 36, W, H - 36); }
  for (const p of list) label(p);
  placeBubbles();
  $("clock").textContent = `${String(Math.floor(hh)).padStart(2, "0")}:${String(Math.floor((hh % 1) * 60 / 10) * 10).padStart(2, "0")} · ${periodOf(hh)}`;
}

// ---------- bubbles (HTML over the canvas) ----------
const wrap = $("wrap");
function bubble(p, text, kind = "") {
  if (p.bubble) p.bubble.el.remove();
  const el = document.createElement("div");
  el.className = "bub " + kind;
  el.textContent = text.length > 150 ? text.slice(0, 147) + "…" : text;
  wrap.appendChild(el);
  p.bubble = { el };
}
function clearBubble(p) { p.bubble?.el.remove(); p.bubble = null; }
const dwell = (text) => 900 + Math.min(text.length, 150) * 28;

function placeBubbles() {
  const k = cv.clientWidth / W;
  for (const p of people.values()) if (p.bubble) {
    p.bubble.el.style.left = Math.round(p.x * k) + "px";
    p.bubble.el.style.top = Math.round((p.y - 2) * k) + "px";
  }
}

function fit() {
  const availW = innerWidth - 354 - 314, availH = innerHeight - 16;
  const k = Math.max(1, Math.min(availW / W, availH / H));
  cv.style.width = Math.floor(W * k) + "px";
  cv.style.height = Math.floor(H * k) + "px";
}
addEventListener("resize", fit);
fit();

let last = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  step(dt); tickClock(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- sim state + feed ----------
let S = null;
const feed = $("feed");
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US");

function hud() {
  $("day").textContent = S.day;
  $("maxday").textContent = $("days").value;
  $("budget").textContent = fmt(S.budget);
  $("spent").textContent = "$" + S.spent.toFixed(5);
  $("cap").textContent = "$" + S.cap;
  $("calls").textContent = S.calls;
  const f = Math.min(1, S.spent / S.cap);
  $("bar").style.width = f * 100 + "%";
  $("bar").style.background = f > 0.9 ? "var(--bad)" : "var(--ok)";
}

const EMPTY_PRODUCT = "No summary yet. Press Start and it will appear here at the end of each day.";
/** Right panel: one card per day (newest on top); customer lines are appended to that day's card. */
function dayCard(day) {
  const box = $("notes");
  let c = box.querySelector(`[data-day="${day}"]`);
  if (!c) {
    c = document.createElement("div"); c.className = "dc"; c.dataset.day = day;
    c.innerHTML = `<div class="dh">Day ${day}</div><div class="ds"></div><div class="dn"></div><div class="fin"></div><div class="dx"></div>`;
    box.prepend(c);
  }
  return c;
}
/** Daily finance report, derived from engine events (the engine is the only source of money changes). */
const fin = {};
function finOf(day) { return (fin[day] ??= { salary: 0, rent: 0, hire: 0, sev: 0, spend: [], income: 0, byCust: {}, cash: null }); }
function renderFin(day) {
  const f = finOf(day);
  const spend = f.spend.reduce((s, x) => s + x.amt, 0);
  const out = f.salary + f.rent + f.hire + f.sev + spend;
  const row = (l, v, cls = "") => v ? `<div class="r ${cls}"><span>${l}</span><b>${cls === "in" ? "+" : "−"}${fmt(v)}</b></div>` : "";
  const net = f.income - out;
  dayCard(day).querySelector(".fin").innerHTML =
    (Object.entries(f.byCust).map(([n, v]) => row(`Customer: ${n}`, v, "in")).join("") || `<div class="r none"><span>No income</span><b>0</b></div>`) +
    row("Salaries", f.salary, "out") + row("Office rent", f.rent, "out") + row("Hiring fees", f.hire, "out") + row("Severance", f.sev, "out") +
    f.spend.map((x) => row(`Spend: ${x.why || "-"}`, x.amt, "out")).join("") +
    `<div class="r tot"><span>Day result</span><b class="${net >= 0 ? "pos" : "neg"}">${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}</b></div>` +
    (f.cash == null ? "" : `<div class="r"><span>Cash (end of day)</span><b>${fmt(f.cash)}</b></div>`);
}
function finTotals() {
  let inc = 0, out = 0;
  for (const f of Object.values(fin)) { inc += f.income; out += f.salary + f.rent + f.hire + f.sev + f.spend.reduce((s, x) => s + x.amt, 0); }
  return { inc, out };
}
function note(day, text, cls = "") {
  const d = document.createElement("div"); d.className = cls; d.textContent = text;
  dayCard(day).querySelector(".dx").appendChild(d);
}
function showBankrupt(day) {
  const t = finTotals();
  $("broke-sub").textContent = `Out of cash on day ${day} · total income ${fmt(t.inc)} · total costs ${fmt(t.out)} · press Reset to start over`;
  $("broke").style.display = "flex";
}
function banner(t) { const b = $("banner"); b.textContent = t; b.style.display = t ? "block" : "none"; }

/** Instant bookkeeping: HUD numbers, feed line, people list. Returns the animation to play (live events only). */
const dayCounts = {};
function apply(e, live) {
  const p = e.payload ?? {};
  S.day = Math.max(S.day, e.day);
  setTime(e, (dayCounts[e.day] ??= {}));
  if (e.cost_usd) { S.spent += e.cost_usd; S.calls++; }
  if (typeof p.budget === "number") S.budget = p.budget;
  if (e.day > 0) {
    const f = finOf(e.day);
    if (e.type === "salary") { f.salary = p.total; f.rent = p.rent ?? 0; }
    else if (e.type === "hire" && p.ok) f.hire += p.fee ?? 0;
    else if (e.type === "fire" && p.ok) f.sev += p.severance ?? 0;
    else if (e.type === "spend" && p.ok) f.spend.push({ amt: p.amount, why: p.why });
    else if (e.type === "subscription_payment") { f.income += p.amount; f.byCust[p.name ?? e.actor] = (f.byCust[p.name ?? e.actor] ?? 0) + p.amount; }
    if (["salary", "hire", "fire", "spend", "subscription_payment"].includes(e.type)) { if (typeof p.budget === "number") f.cash = p.budget; if (f.reported) renderFin(e.day); }
  }
  const mgr = people.get("manager");
  const SPOT = { x: MANAGER_HOME.x + 34, y: MANAGER_HOME.y + 22 };
  const visitor = () => {
    if (!people.has(e.actor)) { names.set(e.actor, { name: p.name ?? e.actor, title: "Customer" }); addPerson(e.actor, "customer", SPOT, { fromDoor: true }); }
    return people.get(e.actor);
  };
  const leave = async (c) => { await walkTo(c, DOOR.x, DOOR.y); people.delete(e.actor); };
  let text = null, anim = null;
  switch (e.type) {
    case "daily_reply":
      text = `${nm("manager")} (CEO): ${p.reply}`;
      anim = async () => { bubble(mgr, p.reply, "dec"); await sleep(dwell(p.reply)); clearBubble(mgr); };
      break;
    case "work": {
      text = `${nm(e.actor)}: ${p.work}`;
      const w = people.get(e.actor);
      anim = async () => { if (!w) return; bubble(w, p.work); await sleep(dwell(p.work) * 0.7); clearBubble(w); };
      break;
    }
    case "message": {
      text = `${nm(e.actor)} → ${nm(e.target)}: ${p.text}`;
      anim = async () => {
        const a = people.get(e.actor), b = people.get(e.target);
        if (!a || !b) return;
        // walk next to the receiver, talk, walk back
        const side = a.home.x <= b.home.x ? -16 : 16;
        await walkTo(a, b.x + side, b.y);
        a.dir = side < 0 ? "right" : "left";
        b.dir = side < 0 ? "left" : "right";
        bubble(a, p.text);
        await sleep(dwell(p.text));
        clearBubble(a);
        b.dir = "down";
        await walkTo(a, a.home.x, a.home.y);
        a.dir = "down";
      };
      break;
    }
    case "hire":
      if (p.ok) {
        text = `Hired: ${NAMES[nameIdx % NAMES.length]} (${TITLES[p.role] ?? p.role}, salary ${p.salary})`;
        const free = SLOTS.find((s) => ![...people.values()].some((q) => q.home === s)) ?? SLOTS[SLOTS.length - 1];
        const n = addPerson(p.id, "employee", free, { fromDoor: live, title: p.role });
        n.title = p.role;
        anim = async () => {
          bubble(mgr, `Welcome ${nm(p.id)}! (${TITLES[p.role] ?? p.role})`, "ok");
          await walkTo(n, free.x, free.y);
          await sleep(900); clearBubble(mgr);
        };
        if (live) n.target = null;
      } else {
        text = `Hire rejected: ${p.reason}`;
        anim = async () => { bubble(mgr, `No hire: ${p.reason}`, "bad"); await sleep(dwell(p.reason ?? "")); clearBubble(mgr); };
      }
      break;
    case "fire":
      if (p.ok) {
        text = `Fired: ${nm(e.target)} (severance ${p.severance})`;
        const gone = people.get(e.target);
        anim = async () => {
          bubble(mgr, `${nm(e.target)} has been let go.`, "bad");
          await sleep(900); clearBubble(mgr);
          if (gone) { await walkTo(gone, DOOR.x, DOOR.y); }
          people.delete(e.target);
        };
        if (!live) people.delete(e.target);
      } else {
        text = `Firing rejected: ${p.reason}`;
        anim = async () => { bubble(mgr, `Not fired: ${p.reason}`, "bad"); await sleep(1500); clearBubble(mgr); };
      }
      break;
    case "spend":
      text = p.ok ? `Spend approved: ${p.amount} (${p.why ?? p.reason ?? ""})` : `Spend rejected: ${p.reason}`;
      anim = async () => { bubble(mgr, text, p.ok ? "ok" : "bad"); await sleep(1800); clearBubble(mgr); };
      break;
    case "day_summary": {
      const pr = $("product"); pr.className = ""; pr.textContent = p.product;
      const c = dayCard(e.day);
      c.querySelector(".ds").textContent = p.status;
      c.querySelector(".dn").textContent = p.next ? `Next: ${p.next}` : "";
      finOf(e.day).reported = true; renderFin(e.day); // finance is part of the daily report, shown with it
      break;
    }
    case "salary": text = `Salaries paid: ${fmt(p.total)}`; break;
    case "day_end":
      // end of the work day: everybody goes home through the door, the office stays empty overnight
      for (const q of people.values()) if (q.role !== "customer") { if (live) clearBubble(q); else { q.x = DOOR.x; q.y = DOOR.y; q.target = null; q.away = true; } }
      anim = async () => {
        await Promise.all([...people.values()].filter((q) => q.role !== "customer" && !q.away).map(async (q) => { await walkTo(q, DOOR.x, DOOR.y); q.away = true; }));
      };
      break;
    case "customer_review":
      text = `${p.name}: ${p.feedback}`;
      note(e.day, `${p.name}: ${p.feedback}`, "cust");
      anim = async () => {
        const c = visitor();
        await walkTo(c, SPOT.x, SPOT.y); c.dir = "left";
        bubble(c, p.feedback, "dec"); await sleep(dwell(p.feedback)); clearBubble(c);
      };
      break;
    case "set_price":
      text = p.ok ? `Price set: ${fmt(p.price)}/day` : `Price rejected: ${p.reason}`;
      note(e.day, p.ok ? `🏷️ CEO set the subscription to ${fmt(p.price)}/day` : `Price rejected: ${p.reason}`, "cust");
      break;
    case "subscription_payment":
      text = `${p.name} subscription: +${fmt(p.amount)}`;
      break;
    case "subscription": {
      const msg = { subscribe: `Subscribed at ${fmt(p.price)}/day ✅`, cancel: "Cancelled my subscription ❌", stay: "Staying subscribed 👍", none: "Not subscribing (yet)." }[p.action] ?? "";
      text = `${p.name}: ${msg}`;
      note(e.day, `${p.action === "subscribe" ? "✅" : p.action === "cancel" ? "❌" : "•"} ${p.name}: ${msg}`, "cust");
      anim = async () => {
        const c = visitor();
        if (c.x !== SPOT.x || c.y !== SPOT.y) await walkTo(c, SPOT.x, SPOT.y);
        c.dir = "left";
        bubble(c, msg, p.action === "cancel" || p.action === "none" ? "bad" : "ok");
        await sleep(1500); clearBubble(c);
        await leave(c);
      };
      break;
    }
    case "sim_stopped":
      banner(`Stopped: ${p.reason}`); text = `STOPPED: ${p.reason}`;
      if (p.reason === "bankrupt") showBankrupt(e.day);
      break;
    default: break; // plan, daily_retro, work, product_update stay out of the feed
  }
  // morning: the first workday event after the night brings everybody back in through the door
  const nightTypes = ["day_end", "sim_stopped"];
  if (!nightTypes.includes(e.type)) {
    const back = [...people.values()].filter((q) => q.away && q.role !== "customer");
    for (const q of back) { q.x = DOOR.x; q.y = DOOR.y; q.target = null; q.away = false; if (!live) { q.x = q.home.x; q.y = q.home.y; } }
    if (live && back.length) {
      const main = anim;
      anim = async () => { await Promise.all(back.map((q) => walkTo(q, q.home.x, q.home.y))); if (main) await main(); };
    }
  }
  hud();
  return live ? anim : null;
}

function reset(h) {
  for (const p of people.values()) clearBubble(p);
  people.clear();
  names.clear(); nameIdx = 0; customerIds = (h.customers ?? []).map((c) => c.id);
  nextCharIdx = 1;
  $("notes").innerHTML = "";
  for (const k of Object.keys(fin)) delete fin[k];
  $("broke").style.display = "none";
  $("product").className = "empty"; $("product").textContent = EMPTY_PRODUCT;
  banner("");
  S = { day: 0, budget: h.budget, spent: 0, calls: 0, cap: h.cap, mock: h.mock, hasKey: h.hasKey, model: h.model };
  addPerson("manager", "manager", MANAGER_HOME);
    h.employees.forEach((e, i) => addPerson(e.id, "employee", SLOTS[i], { title: e.role }));
  for (const k of Object.keys(dayCounts)) delete dayCounts[k];
  clock = clockTarget = 6;
  for (const e of h.history) apply(e, false);
  clock = clockTarget;
  hud();
}

// live events are played one by one so the viewer can follow; long backlogs speed up
const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    speedMul = queue.length > 30 ? 5 : queue.length > 12 ? 2.5 : 1;
    const anim = apply(queue.shift(), true);
    if (anim) await anim();
  }
  speedMul = 1;
  busy = false;
}

// ---------- socket ----------
const ws = new WebSocket(`ws://${location.host}/ws`);
let running = false;
let stopping = false;
function setRunning(r) {
  running = r; if (!r) stopping = false;
  $("go").disabled = r; $("go").textContent = r ? "Running…" : "▶ Start";
  $("stop").disabled = !r || stopping; $("stop").textContent = stopping ? "Stopping…" : "⏸ Stop";
  $("reset").disabled = r;
}
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.t === "hello") { queue.length = 0; stopping = false; reset(d); setRunning(d.running); }
  else if (d.t === "event") { if (!stopping) { queue.push(d.e); pump(); } }
  else if (d.t === "cap") { if (S) { S.cap = d.cap; hud(); } }
  else if (d.t === "running") setRunning(d.running);
  else if (d.t === "error") banner("Error: " + d.message);
  else if (d.t === "done") {
    const t = setInterval(() => { if (!busy && !queue.length) { clearInterval(t); banner(`Finished: ${d.stopped ?? "day limit"} · ${d.calls} calls · $${d.spentUsd.toFixed(6)} / $${S.cap}`); } }, 200);
  }
};
ws.onclose = () => banner("Server connection lost.");
$("go").onclick = () => ws.send(JSON.stringify({ cmd: "start", mock: !S.hasKey, days: $("days").value, fresh: false }));
$("addcap").onclick = () => ws.send(JSON.stringify({ cmd: "addBudget" }));
$("days").oninput = () => { if (S) hud(); };
$("stop").onclick = () => { stopping = true; queue.length = 0; setRunning(true); ws.send(JSON.stringify({ cmd: "stop" })); };
$("reset").onclick = () => { if (!running && confirm("All progress will be deleted and the sim restarts from day 1. Sure?")) ws.send(JSON.stringify({ cmd: "reset" })); };
