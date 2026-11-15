/* =====================================================================
   GHOST ROVERS · MISSION TASKS (mini-games)
   A small reusable system. Each task is one file in this folder that calls

     Tasks.add("siteId", {
       title: "Land the Eagle!",            // short title
       hint:  "One short hint line.",       // at most one line
       start(s, T) { ... }                  // set up the task's state in s
       step(s, dt, inp, T) { ... }          // move things; set s.p (0..1 progress) and s.done = true to finish
       draw(s, g, T) { ... }                // draw on an 800 x 450 canvas
     });

   Controls are the same for every task and use what the game already has:
     inp.px    a pointer that slides left and right (steering, or the mouse)
     inp.hold  the DRIVE / next button held down (or the mouse button)
     inp.press true on the frame the button goes down
   T.assist goes from 0 to 1 after about 30 seconds, so tasks can make targets bigger.
   Tasks cannot be failed: the bar also fills by itself after a while, so everyone finishes.

   To add a task: copy one of the files, change the id to a machine's id from js/data.js,
   and add the file name to the list in index.html.
   ===================================================================== */
const Tasks = (() => {
  const W = 800, H = 450, INK = "#141a3c", defs = {};
  let cur = null, el = null, g = null, fx = {};
  const inp = { x: 0, px: W / 2, hold: false, press: false, back: false, mouse: false, mouseHold: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, rnd = (a, b) => a + Math.random() * (b - a);

  // ---- drawing helpers shared by every task: chunky shapes with dark outlines ----
  const T = {
    W, H, INK, clamp, lerp, rnd, assist: 0, time: 0, world: "moon",
    C: { gold: "#e6ad3c", silver: "#cbd3de", white: "#f5f3ec", dark: "#2a2e3a", mid: "#6d7484", navy: "#2f55b5", cyan: "#59d8ff", go: "#3ddc6f", sun: "#ffd23f", pink: "#ff7ac8", orange: "#ff9a2e", red: "#ff5d6c" },
    fin(g, fill, lw) { if (fill) { g.fillStyle = fill; g.fill(); } g.lineJoin = g.lineCap = "round"; g.strokeStyle = INK; g.lineWidth = lw || 4; g.stroke(); },
    circ(g, x, y, r, fill, lw) { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, 7); T.fin(g, fill, lw); },
    box(g, x, y, w, h, r, fill, lw) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r || 0); else g.rect(x, y, w, h); T.fin(g, fill, lw); },
    poly(g, pts, fill, lw) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); T.fin(g, fill, lw); },
    line(g, x1, y1, x2, y2, w, col) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineCap = "round"; g.strokeStyle = INK; g.lineWidth = w + 4; g.stroke(); g.strokeStyle = col; g.lineWidth = w; g.stroke(); },
    text(g, str, x, y, size, col, align) { g.font = "700 " + size + "px Fredoka, ui-rounded, system-ui, sans-serif"; g.textAlign = align || "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.strokeStyle = INK; g.lineWidth = size / 4; g.strokeText(str, x, y); g.fillStyle = col || "#fff"; g.fillText(str, x, y); },
    glow(g, x, y, r, col, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(255,255,255,0)"); g.globalAlpha = a == null ? .7 : a; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalAlpha = 1; },
    // a glowing "do it here" target: pulsing ring, bouncing arrow and a ring that fills while you hold
    target(g, x, y, r, frac) {
      const p = .5 + .5 * Math.sin(T.time * 5), big = r * (1 + T.assist * .6);
      T.glow(g, x, y, big * 2.2, "rgba(61,220,111,.9)", .35 + .25 * p + T.assist * .3);
      g.setLineDash([8, 7]); g.lineDashOffset = -T.time * 20; g.strokeStyle = T.C.go; g.lineWidth = 4; g.beginPath(); g.arc(x, y, big, 0, 7); g.stroke(); g.setLineDash([]);
      const ay = y - big - 22 - p * 10; T.poly(g, [[x - 12, ay - 14], [x + 12, ay - 14], [x, ay + 4]], T.C.go, 3);
      if (frac > 0) { g.strokeStyle = "#fff"; g.lineWidth = 7; g.lineCap = "round"; g.beginPath(); g.arc(x, y, big + 9, -Math.PI / 2, -Math.PI / 2 + clamp(frac, 0, 1) * Math.PI * 2); g.stroke(); }
    },
    // hold the button with the pointer over a spot: returns how full it is (0..1). Fills in "need" seconds.
    hot(s, key, x, r, need, dt) {
      s.actionAligned = Math.abs(inp.px - x) < r * (1 + T.assist * .8);
      const on = s.actionAligned && inp.hold; s.actionHolding = on;
      s[key] = clamp((s[key] || 0) + (on ? dt / need : -dt * .6), 0, 1); return s[key];
    },
    pointer(g, x, y) { // the little hand you move
      const d = inp.hold ? 4 : 0; g.save(); g.translate(x, y + d);
      T.poly(g, [[0, 0], [-15, -30], [-5, -27], [-5, -52], [5, -52], [5, -27], [15, -30]], inp.hold ? T.C.sun : "#fff", 3.5); g.restore();
    },
    sky(g, w) {
      const moon = (w || T.world) === "moon", gr = g.createLinearGradient(0, 0, 0, H);
      if (moon) { gr.addColorStop(0, "#04050f"); gr.addColorStop(1, "#141a3c"); } else { gr.addColorStop(0, "#c88a5c"); gr.addColorStop(1, "#f4cfa2"); }
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      if (moon) { g.fillStyle = "#fff"; for (let i = 0; i < 60; i++) { const x = (i * 137.5) % W, y = (i * 71.3) % (H * .75); g.globalAlpha = .4 + .6 * ((i * 7) % 5) / 5; g.fillRect(x, y, 2, 2); } g.globalAlpha = 1; }
    },
    ground(g, y, w) {
      const moon = (w || T.world) === "moon"; g.fillStyle = moon ? "#8d909c" : "#d8632f"; g.fillRect(0, y, W, H - y);
      g.fillStyle = moon ? "#a9acb8" : "#ec8548"; g.fillRect(0, y, W, 9);
      g.fillStyle = moon ? "rgba(60,62,75,.35)" : "rgba(140,50,20,.35)"; for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse((i * 173 + 60) % W, y + 26 + (i * 37) % Math.max(20, H - y - 40), 26 + (i * 11) % 30, 7, 0, 0, 7); g.fill(); }
    },
    earth(g, x, y, r) { T.glow(g, x, y, r * 2.4, "rgba(110,180,255,.9)", .35); T.circ(g, x, y, r, "#2f7fe0", 3); g.save(); g.beginPath(); g.arc(x, y, r - 2, 0, 7); g.clip(); g.fillStyle = "#4fc26a"; g.beginPath(); g.ellipse(x - r * .25, y - r * .1, r * .45, r * .32, .5, 0, 7); g.ellipse(x + r * .4, y + r * .45, r * .3, r * .4, 1, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.ellipse(x + r * .1, y - r * .55, r * .6, r * .1, -.2, 0, 7); g.ellipse(x - r * .3, y + r * .5, r * .5, r * .09, .1, 0, 7); g.fill(); g.restore(); },
    bar(g, x, y, w, h, frac, col, label) { T.box(g, x, y, w, h, Math.min(w, h) / 2, "#0d1230", 3); const f = clamp(frac, 0, 1); if (f > .02) { g.fillStyle = col; g.beginPath(); if (w > h) g.roundRect ? g.roundRect(x + 4, y + 4, (w - 8) * f, h - 8, (h - 8) / 2) : g.rect(x + 4, y + 4, (w - 8) * f, h - 8); else g.roundRect ? g.roundRect(x + 4, y + 4 + (h - 8) * (1 - f), w - 8, (h - 8) * f, (w - 8) / 2) : g.rect(x + 4, y + 4 + (h - 8) * (1 - f), w - 8, (h - 8) * f); g.fill(); } if (label) T.text(g, label, x + w / 2, y - 14, 16); },
    // a row of "hold here" steps done one after another. need = seconds of holding (a number, or one per step)
    seq(s, xs, need, dt, r) {
      if (s.k == null) { s.k = 0; s.h = 0; }
      s.p = Math.min(1, (s.k + (s.h || 0)) / xs.length);
      if (s.k >= xs.length) { s.done = true; return false; }
      const x = xs[s.k]; s.aimX = x; s.aimHold = true;
      const f = T.hot(s, "h", x, r || 44, Array.isArray(need) ? need[s.k] : need, dt);
      if (f >= 1) { s.k++; s.h = 0; s.actionAligned = s.actionHolding = false; T.sfx("snap"); T.buzz("star"); T.spark(x, s.py || 300, T.C.sun, 14); if (s.k >= xs.length) s.done = true; return true; }
      return false;
    },
    spark(x, y, col, n) { if (!cur) return; for (let i = 0; i < (n || 12); i++) { const a = rnd(0, 6.3), v = rnd(40, 220); cur.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: rnd(.4, .9), c: col || T.C.sun, r: rnd(3, 6) }); } },
    puff(x, y, col, n) { if (!cur) return; for (let i = 0; i < (n || 6); i++) cur.parts.push({ x, y, vx: rnd(-50, 50), vy: rnd(-70, -10), t: rnd(.4, .9), c: col || "rgba(220,220,230,.8)", r: rnd(4, 9), soft: true }); },
    sfx(name) { try { fx.sfx && fx.sfx(name); } catch (e) { } },
    buzz(kind) { try { fx.buzz && fx.buzz(kind); } catch (e) { } }
  };

  function build() {
    if (el) return;
    el = document.createElement("div"); el.id = "task"; el.className = "overlay hidden";
    el.innerHTML = '<div class="box taskbox"><div class="taskhead"><div><div class="kicker" id="taskKicker">Mission task</div><h2 id="taskTitle"></h2><p id="taskHint"></p><p class="hint" id="taskKeys"></p><p id="taskAction" style="font-size:16px;font-weight:700;color:#fff;margin:7px 0 0"></p><span id="taskAnnounce" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap"></span></div><button class="btn alt" id="taskSkip">Skip ▶</button></div>' +
      '<div class="taskstage"><canvas id="taskCv" role="img" aria-label="Mission task. Use steering to move and hold Enter or the drive button to interact."></canvas><div id="taskStamp" aria-hidden="true">MISSION TASK DONE ✓</div></div><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:10px;font-size:13px;font-weight:700;color:#c7cfff"><span id="taskProgressText">Mission progress · 0%</span><span id="taskAssist" role="status" style="color:#ffe19a"></span></div><div class="taskbar" style="margin-top:5px" role="progressbar" aria-label="Mission task progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="taskFill"></i></div></div>';
    if (typeof Icons !== "undefined") Icons.label(el.querySelector("#taskKicker"), "tool", "Mission task");
    document.getElementById("hostView").appendChild(el);
    const cv = el.querySelector("#taskCv"); cv.width = W * 2; cv.height = H * 2; g = cv.getContext("2d");
    const at = e => { if (fx.pointerInput === false) return; const r = cv.getBoundingClientRect(), range = cur && cur.d.pointerRange || [0, W]; inp.px = clamp((e.clientX - r.left) / r.width * W, range[0], range[1]); inp.mouse = true; };
    cv.addEventListener("pointermove", at);
    cv.addEventListener("pointerdown", e => { if (fx.pointerInput === false) return; at(e); inp.mouseHold = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { } e.preventDefault(); });
    ["pointerup", "pointercancel"].forEach(n => cv.addEventListener(n, () => inp.mouseHold = false));
    el.querySelector("#taskSkip").onclick = () => skip();
  }

  function start(id, o) {
    const d = defs[id]; if (!d) return false; build(); o = o || {}; fx = o;
    cur = { id, d, s: { p: 0, done: false }, t: 0, parts: [], doneT: -1, onEnd: o.onEnd };
    Object.assign(inp, { px: W / 2, hold: false, press: false, mouse: false, mouseHold: false, x: 0 }); T.assist = 0; T.time = 0; T.world = o.world || d.world || "moon";
    el.querySelector("#taskTitle").textContent = d.title; el.querySelector("#taskHint").textContent = d.hint || "";
    el.querySelector("#taskCv").setAttribute("aria-label", d.title + ". " + (d.hint || "") + (d.steerOnly ? " Use steering or the pointer to adjust." : " Use steering to move and hold Enter or the drive button to interact."));
    el.querySelector("#taskStamp").classList.remove("show"); el.querySelector("#taskStamp").setAttribute("aria-hidden", "true"); el.querySelector(".taskbar").setAttribute("aria-valuenow", "0"); el.querySelector("#taskFill").style.width = "0%"; el.classList.remove("hidden");
    el.querySelector("#taskAnnounce").textContent = "";
    d.start(cur.s, T); feedback(); return true;
  }
  function feedback() {
    if (!cur || !el) return;
    const { d, s } = cur, write = (selector, text) => { const node = el.querySelector(selector); if (node.textContent !== text) node.textContent = text; };
    const labels = d.actions, action = typeof d.action === "function" ? d.action(s, inp, T) : labels ? labels[Math.min(s.k || 0, labels.length - 1)] : "Follow the glowing target";
    const state = s.done ? "Complete!" : typeof d.status === "function" ? d.status(s, inp, T) : s.actionHolding ? "Holding…" : s.actionAligned ? "Aligned — hold to work" : "Move to the glowing spot";
    const cue = [action, state].filter(Boolean).join(" · ");
    write("#taskAction", cue);
    // Visual feedback stays immediate. Speak only a settled cue, so small
    // alignment corrections do not repeatedly interrupt a screen reader.
    if (cue !== cur.feedbackCandidate) { cur.feedbackCandidate = cue; cur.feedbackSince = cur.t; }
    if (s.done || (cur.t - cur.feedbackSince >= .4 && cur.t - (cur.announcedAt == null ? -2 : cur.announcedAt) >= 1.5)) {
      if (el.querySelector("#taskAnnounce").textContent !== cue) { write("#taskAnnounce", cue); cur.announcedAt = cur.t; }
    }
    const percent = Math.round(clamp(s.p, 0, 1) * 100);
    write("#taskProgressText", "Mission progress · " + percent + "%");
    write("#taskAssist", cur.t >= 40 ? "Helping hands · finishing together" : cur.t >= 30 ? "Helping hands · targets are easier" : "");
    el.querySelector("#taskAction").style.color = s.done || s.actionHolding ? "#bfffcf" : s.actionAligned ? "#ffe19a" : "#fff";
  }
  function end(ok) { const c = cur; cur = null; if (el) el.classList.add("hidden"); if (c && c.onEnd) c.onEnd(ok); }
  function skip() { if (cur) end(cur.doneT >= 0); }
  function cancel() { cur = null; if (el) el.classList.add("hidden"); Object.assign(inp, { hold: false, press: false, mouseHold: false, x: 0 }); }


  // one frame. raw = { x: steering -1..1, hold: button held }. Works without a screen too, so tests can run tasks quickly.
  function step(dt, raw, noDraw) {
    if (!cur) return; const c = cur, s = c.s; raw = raw || {};
    const hold = !!raw.hold || inp.mouseHold; inp.press = hold && !inp.hold; inp.hold = hold; inp.x = raw.x || 0; inp.back = !!raw.back;
    if (inp.x) { inp.mouse = false; const range = c.d.pointerRange || [0, W]; inp.px = clamp(inp.px + inp.x * 520 * dt, range[0], range[1]); }
    c.t += dt; T.time = c.t; T.assist = clamp((c.t - 30) / 10, 0, 1);
    if (c.doneT < 0) {
      c.d.step(s, dt, inp, T);
      if (c.t > 40) s.p = Math.max(s.p, (c.t - 40) / 12); // nobody gets stuck: after a while the bar finishes on its own
      if (s.done || s.p >= 1) { s.p = 1; s.done = true; c.doneT = 0; T.sfx("done"); T.buzz("found"); for (let i = 0; i < 5; i++) T.spark(rnd(150, 650), rnd(100, 300), [T.C.sun, T.C.cyan, T.C.pink, T.C.go][i % 4], 16); if (el) el.querySelector("#taskStamp").classList.add("show"); }
    } else { c.doneT += dt; if (c.doneT > 1.7) { end(true); return; } }
    for (const p of c.parts) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; if (!p.soft) p.vy += 300 * dt; }
    c.parts = c.parts.filter(p => p.t > 0);
    feedback();
    if (noDraw || !g) return;
    g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H); g.save(); c.d.draw(s, g, T, inp); g.restore();
    if (!s.noPointer && c.doneT < 0) T.pointer(g, inp.px, s.py || 420);
    for (const p of c.parts) { g.globalAlpha = clamp(p.t * 2.5, 0, 1); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); } g.globalAlpha = 1;
    const percent = Math.round(clamp(s.p, 0, 1) * 100);
    el.querySelector("#taskFill").style.width = percent + "%";
    el.querySelector(".taskbar").setAttribute("aria-valuenow", String(percent));
    el.querySelector("#taskStamp").setAttribute("aria-hidden", String(!s.done));
  }

  return { add(id, def) { defs[id] = def; }, has: id => !!defs[id], title: id => defs[id] && defs[id].title, ids: () => Object.keys(defs),
    start, step, skip, finish: ok => end(!!ok), cancel, currentId: () => cur && cur.id, pointerRange: () => cur && cur.d.pointerRange || [0, W], active: () => !!cur, steerOnly: () => !!(cur && cur.d.steerOnly), state: () => cur && cur.s, elapsed: () => cur ? cur.t : 0, T, inp };
})();
