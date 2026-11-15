/* =====================================================================
   GHOST ROVERS · THE GAME (laptop screen)
   A chase-camera 3D view built with three.js. The driving still happens on
   a flat map of real coordinates (x = longitude, y = latitude), exactly as
   before; the 3D world is drawn on top of that map.
   ===================================================================== */
function startHost() {
  const T = THREE, $ = id => document.getElementById(id);
  $("hostView").classList.remove("hidden");
  const store = { get(k, d) { try { return localStorage.getItem("gr_" + k) || d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem("gr_" + k, v); } catch (e) { } } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k;
  const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

  // ------------------------------------------------------------------
  // renderer, scene, camera
  // ------------------------------------------------------------------
  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas: $("game"), antialias: true, powerPreference: "high-performance" }); }
  catch (_) { throw new Error("The game couldn't start its 3D graphics. Try enabling hardware acceleration or opening it in another browser."); }
  let graphicsBlocked = false;
  const lostContexts = new Set();
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(62, 1, 2, 30000);
  let vw = 1, vh = 1, quality = Math.min(1.5, window.devicePixelRatio || 1);
  function resize() {
    vw = innerWidth; vh = innerHeight; renderer.setPixelRatio(quality); renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh; camera.updateProjectionMatrix();
    const fx = $("fx"); fx.width = vw; fx.height = vh;
    if (mini && mini.S) setupMini();
  }
  addEventListener("resize", resize); resize();

  const hemi = new T.HemisphereLight(0xffffff, 0x333333, .5); scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 1); scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xb9d4ff, .16); scene.add(fill, fill.target);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0015; sun.shadow.normalBias = 1.5;
  Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 1200 }); sun.shadow.camera.updateProjectionMatrix();
  const sunDir = new T.Vector3();

  // ------------------------------------------------------------------
  // game state
  // ------------------------------------------------------------------
  let worldKey = "moon", WD = WORLDS.moon, W = { w: 1, h: 1 }, sites = [], stars = [], labels = [];
  const found = new Set(), starsGot = new Set();
  const deepSeen = new Set(); let deepI = 0;
  const rover = { x: 0, y: 0, h: -Math.PI / 2, v: 0, alt: 0, vy: 0, air: false, pitch: 0, roll: 0, steer: 0, boost: 0, gPrev: 0, gVy: 0 };
  let mode = "lobby", bookOpen = false, card = null, cardKind = null, lastPing = -1, countT = 0, countN = -1;
  let revive = null, shake = 0, camH = rover.h, beepT = 0, sig = 0, sigDist = "", time = 0;
  const keys = {};
  let progressStorage = null;
  try { progressStorage = window.localStorage; } catch (_) { }
  const progress = Progress.create(progressStorage, WORLDS, DEEP);
  let savedProgress = progress.load(), progressStarted = false, pendingSite = null, pendingPhase = null, pendingDeep = null, bookReturn = null, saveFailed = !progressStorage;
  function paintProgress() {
    const has = !!savedProgress;
    $("continueBtn").textContent = has ? "Continue " + WORLDS[savedProgress.world].short + " ▶" : "Continue ▶";
    $("continueBtn").classList.toggle("hidden", !has);
    $("newGameBtn").classList.toggle("hidden", !has);
    $("kbStart").classList.toggle("hidden", has);
    const message = saveFailed ? "Progress could not be saved. You can still play this session." : has ? "Your discoveries are saved on this browser." : "Discoveries save automatically on this browser.";
    if ($("saveStatus").textContent !== message) $("saveStatus").textContent = message;
  }
  function saveProgress() {
    // Title-world selection is only a preview; blur/pagehide must preserve the
    // last actual exploration checkpoint rather than save its preview position.
    if (!progressStarted || mode === "lobby") return;
    const data = { version: Progress.VERSION, world: worldKey, rover: { x: rover.x, y: rover.y, h: rover.h }, found: [...found], stars: [...starsGot], tasks: [...tasksDone], deep: [...deepSeen], seen: [...cardSeen], pendingSite, pendingPhase, pendingDeep,
      clocks: Object.fromEntries(Object.keys(WORLDS).map(k => [k, { left: clock.left[k], free: clock.free[k] }])) };
    savedProgress = progress.normalize(data);
    saveFailed = !progress.save(data); paintProgress();
  }

  const toXY = (lat, lon) => [(lon - WD.lonMin) * WD.ppd, (WD.latMax - lat) * WD.ppd];
  const wdx = dx => WD.wrap ? dx - Math.round(dx / W.w) * W.w : dx;   // shortest east-west distance on a wrapped planet
  const rx = x => rover.x + wdx(x - rover.x);                          // where to draw something so it's on the near side

  // ------------------------------------------------------------------
  // terrain: hills, dunes and craters from repeatable "noise"
  // ------------------------------------------------------------------
  function hash(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  const wrapI = (i, cell) => { if (!WD.wrap) return i; const p = Math.round(W.w / cell); return ((i % p) + p) % p; };
  function vn(x, y, cell, seed) {
    let fx = x / cell, fy = y / cell; const ix = Math.floor(fx), iy = Math.floor(fy); fx -= ix; fy -= iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), a = wrapI(ix, cell), b = wrapI(ix + 1, cell);
    return lerp(lerp(hash(a, iy, seed), hash(b, iy, seed), sx), lerp(hash(a, iy + 1, seed), hash(b, iy + 1, seed), sx), sy);
  }
  const ti = { shade: 0, tint: 0, c: 0 }; // extra info from the last height lookup, used for colouring
  // Places obstacles must keep away from: every ghost, every science star and the start. (Filled in by buildWorld.)
  let clearPts = [], craterMemo = new Map();
  const isClear = (px, pz, rad) => !clearPts.some(c => Math.hypot(wdx(c.x - px), c.y - pz) < rad + c.r);
  function craterCell(ix, iz, cell, prob, rmin, rmax) { // the crater (if any) that lives in one square of the map
    const m = wrapI(ix, cell), key = m * 8191 + iz; let c = craterMemo.get(key);
    if (c === undefined) {
      c = null;
      if (hash(m, iz, 21) <= prob) {
        const q = hash(m, iz, 22), r = rmin + q * q * (rmax - rmin), fx = .2 + .6 * hash(m, iz, 23), fz = .2 + .6 * hash(m, iz, 24);
        // On Mars craters are obstacles, so none may sit on a ghost, a star or the start
        if (worldKey === "moon" || isClear((m + fx) * cell, (iz + fz) * cell, r * 1.2)) c = { r, fx, fz };
      }
      craterMemo.set(key, c);
    }
    return c;
  }
  function craters(x, z, cell, prob, rmin, rmax) {
    let out = 0, c = 0; const cx = Math.floor(x / cell), cz = Math.floor(z / cell), steep = worldKey !== "moon"; // Mars craters have tall, steep rims
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const ix = cx + dx, iz = cz + dz, cr = craterCell(ix, iz, cell, prob, rmin, rmax); if (!cr) continue;
      const r = cr.r, d = Math.hypot(x - (ix + cr.fx) * cell, z - (iz + cr.fz) * cell) / r; if (d > 1.6) continue;
      if (d < 1) { out += r * (steep ? .3 : .2) * (d * d - 1); c -= .13 * (1 - d); }
      const e = (d - 1) / .22, rim = Math.exp(-e * e); out += r * (steep ? .17 : .07) * rim; c += .1 * rim;
    }
    ti.c = c; return out;
  }
  function rawH(x, z) {
    const big = vn(x, z, 1200, 11), mid = vn(x, z, 300, 12), sm = vn(x, z, 75, 13);
    let h, shade = (mid - .5) * .16 + (sm - .5) * .1;
    if (worldKey === "moon") {
      h = (big - .5) * 60 + (mid - .5) * 16 + (sm - .5) * 3 + craters(x, z, 400, .62, 30, 140);
      shade += ti.c;
    } else {
      const d = vn(x, z * 2.6, 400, 14), ridge = 1 - Math.abs(2 * d - 1);
      h = (big - .5) * 90 + ridge * ridge * 28 + (mid - .5) * 10 + (sm - .5) * 2 + craters(x, z, 900, .25, 40, 110);
      shade += (ridge * ridge - .3) * .2 + ti.c;
    }
    ti.shade = shade; ti.tint = big; return h;
  }
  function H(x, z) { // ground height, flattened a little around each landing site
    let h = rawH(x, z);
    for (const s of sites) {
      const dx = wdx(s.x - x), dz = s.y - z, d2 = dx * dx + dz * dz;
      if (d2 < 40000) { const w = 1 - smooth((Math.sqrt(d2) - 80) / 120); h += (s.h0 - h) * w; ti.shade *= 1 - w; }
    }
    return h;
  }

  const TN = 120, TC = 30, TV = TN + 1;
  const tGeo = new T.BufferGeometry(), tPos = new Float32Array(TV * TV * 3), tCol = new Float32Array(TV * TV * 3);
  { const idx = []; for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) { const a = j * TV + i; idx.push(a, a + TV, a + 1, a + 1, a + TV, a + TV + 1); }
    tGeo.setIndex(idx); tGeo.setAttribute("position", new T.BufferAttribute(tPos, 3)); tGeo.setAttribute("color", new T.BufferAttribute(tCol, 3)); }
  const terrain = new T.Mesh(tGeo, new T.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.frustumCulled = false; terrain.receiveShadow = true; scene.add(terrain);
  let tcx = 1e9, tcz = 1e9, terrainJob = null;
  terrain.visible = false;

  // optional real maps: moon.jpg / mars.jpg (full-globe, equirectangular) next to index.html
  const maps = {};
  for (const k in WORLDS) {
    const img = new Image();
    img.onload = () => {
      maps[k] = { img };
      try { const c = document.createElement("canvas"); c.width = 1024; c.height = 512; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 1024, 512); maps[k].px = g.getImageData(0, 0, 1024, 512).data; } catch (e) { }
      if (k === worldKey) { terrainJob = null; tcx = 1e9; }
    };
    img.src = k + ".jpg";
  }
  function mapLum(x, z) { // brightness of the real map at this spot, or -1 if there's no map
    const m = maps[worldKey]; if (!m || !m.px) return -1;
    const lon = WD.lonMin + (((x % W.w) + W.w) % W.w) / WD.ppd, lat = clamp(WD.latMax - z / WD.ppd, -89.9, 89.9);
    const u = Math.floor((lon + 180) / 360 * 1024) & 1023, v = Math.floor((90 - lat) / 180 * 512), i = (v * 1024 + u) * 4;
    return (m.px[i] + m.px[i + 1] + m.px[i + 2]) / 765;
  }

  // Build into staging arrays over several frames. The visible mesh, props and
  // collision lists are committed together, so a half-built landscape never shows.
  function updateTerrain(cx, cz) {
    if (terrainJob && terrainJob.world === worldKey) return;
    const obstacles = collectObstacles(cx, cz);
    terrainJob = { cx, cz, world: worldKey, row: 0, obstacles,
      pos: new Float32Array(tPos.length), col: new Float32Array(tCol.length) };
  }
  function stepTerrain() {
    const job = terrainJob; if (!job) return;
    if (job.world !== worldKey) { terrainJob = null; return; }
    const { cx, cz } = job, moon = worldKey === "moon", start = performance.now();
    let rows = 0;
    while (job.row < TV && rows < 16 && (rows === 0 || performance.now() - start < 3)) {
      const j = job.row++; rows++;
      for (let i = 0; i < TV; i++) {
        const p = (j * TV + i) * 3, x = cx + (i - TN / 2) * TC, z = cz + (j - TN / 2) * TC, h = H(x, z);
        job.pos[p] = x; job.pos[p + 1] = h; job.pos[p + 2] = z;
        const lum = mapLum(x, z); let r, g, b;
        if (moon) {
          let v = .58 + ti.shade - Math.max(0, .5 - ti.tint) * .45; if (lum >= 0) v = v * .45 + lum * .75;
          r = v * .97; g = v * .98; b = v * 1.05;
        } else {
          const k = ti.tint, s = ti.shade, m = lum >= 0 ? .55 + lum * .9 : 1;
          r = (lerp(.66, .86, k) + s) * m; g = (lerp(.29, .43, k) + s * .75) * m; b = (lerp(.17, .24, k) + s * .5) * m;
        }
        for (const sd of job.obstacles.sands) { const d = Math.hypot(x - sd.x, z - sd.z) / sd.r; if (d < 1.15) { const k = 1 - smooth((d - .8) / .35); r *= 1 - .2 * k; g *= 1 - .26 * k; b *= 1 - .3 * k; } }
        job.col[p] = r; job.col[p + 1] = g; job.col[p + 2] = b;
      }
    }
    if (job.row < TV) return;
    tPos.set(job.pos); tCol.set(job.col);
    solids = job.obstacles.solids; sands = job.obstacles.sands;
    tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
    tcx = cx; tcz = cz; terrainJob = null; terrain.visible = true;
    updateProps(cx, cz);
  }

  // r149 chooses USE_INSTANCING_COLOR when a material is first compiled.
  // Allocate the attribute before any scene render, including empty batches.
  function prepareInstanceColors(mesh, T) {
    mesh.setColorAt(0, new T.Color(0xffffff));
    mesh.instanceColor.array.fill(1); mesh.instanceColor.setUsage(T.DynamicDrawUsage);
    mesh.material.needsUpdate = true; mesh.count = 0;
    return mesh;
  }

  // rocks and (on Mars) flat-topped mesas, scattered the same way every time
  const dummy = new T.Object3D(), tmpC = new T.Color();
  const rocks = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), new T.MeshLambertMaterial({ flatShading: true }), 520);
  prepareInstanceColors(rocks, T);
  rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false; scene.add(rocks);
  const mesaGeo = new T.CylinderGeometry(.7, 1, 1, 7); mesaGeo.translate(0, .5, 0);
  const mesas = new T.InstancedMesh(mesaGeo, new T.MeshLambertMaterial({ flatShading: true }), 60);
  prepareInstanceColors(mesas, T);
  mesas.frustumCulled = false; scene.add(mesas);
  // Cartoon geology decorates existing solid mesas; every arch stays high on
  // an unreachable top. These batches never add obstacles or change a route.
  function mesaArchGeometry(T) {
    // A deep, broad opening reads as an arch even at an oblique driving angle.
    const shape = new T.Shape();
    shape.moveTo(-1.18, 0); shape.lineTo(-1.18, .28);
    shape.quadraticCurveTo(-.96, 1.2, 0, 1.24);
    shape.quadraticCurveTo(.96, 1.2, 1.18, .28);
    shape.lineTo(1.18, 0); shape.lineTo(.69, 0); shape.lineTo(.69, .25);
    shape.quadraticCurveTo(.55, .76, 0, .8);
    shape.quadraticCurveTo(-.55, .76, -.69, .25);
    shape.lineTo(-.69, 0); shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, { depth: .85, steps: 1, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 1, curveSegments: 3 });
    geometry.translate(0, 0, -.425); return geometry;
  }
  function createMesaLandmarks(T) {
    const group = new T.Group(); group.name = "Layered mesa landmarks";
    const make = (geometry, capacity, color) => {
      const mesh = new T.InstancedMesh(geometry, new T.MeshLambertMaterial({ color, flatShading: true }), capacity);
      mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; group.add(mesh); return mesh;
    };
    const bands = make(new T.CylinderGeometry(.98, 1, 1, 7), 180, 0xffffff);
    prepareInstanceColors(bands, T);
    const caps = make(new T.CylinderGeometry(.67, .72, 1, 7), 60, 0xdba071);
    const arches = make(mesaArchGeometry(T), 60, 0xe8b782);
    arches.castShadow = true;
    return { group, bands, caps, arches, dummy: new T.Object3D(), color: new T.Color() };
  }
  function positionMesaLandmark(set, o, index, base, yaw, stretch, shade) {
    const d = set.dummy, height = o.hgt + 20;
    [.22, .47, .73].forEach((fraction, layer) => {
      const radius = o.R * (1 - .3 * (fraction - .025)) * 1.008;
      d.position.set(o.x, base - 20 + height * fraction, o.z); d.rotation.set(0, yaw, 0);
      d.scale.set(radius, height * .05, radius * stretch); d.updateMatrix();
      set.bands.setMatrixAt(index * 3 + layer, d.matrix);
      const col = layer === 1 ? [.89, .54, .34] : [.52, .25, .19];
      set.bands.setColorAt(index * 3 + layer, set.color.setRGB(col[0] * shade, col[1] * shade, col[2] * shade));
    });
    d.position.set(o.x, base + o.hgt, o.z); d.rotation.set(0, yaw, 0); d.scale.set(o.R, 5, o.R * stretch); d.updateMatrix();
    set.caps.setMatrixAt(index, d.matrix);
    // Stable cell hashes make a recognisable arch stay with its own mesa.
    if (hash(o.m, o.iz, 143) < .45) {
      const scale = o.R * (.3 + hash(o.m, o.iz, 144) * .06);
      d.position.set(o.x, base + o.hgt + 2.5, o.z); d.rotation.set(0, yaw + .35, hash(o.m, o.iz, 145) * .12 - .06);
      d.scale.set(scale, scale * .8, scale); d.updateMatrix();
      set.arches.setMatrixAt(set.arches.count++, d.matrix);
    }
  }
  const mesaLandmarks = createMesaLandmarks(T); scene.add(mesaLandmarks.group);
  // ---- Mars obstacles (Level 2). Each kind lives on its own grid of squares, so they are the same every game. ----
  // All of them keep clear of ghosts, stars and the start, so every ghost can always be reached.
  function mesaAt(ix, iz) {
    const m = wrapI(ix, 900); if (hash(m, iz, 41) > .34) return null;
    const x = (ix + .15 + .7 * hash(m, iz, 42)) * 900, z = (iz + .15 + .7 * hash(m, iz, 43)) * 900, r = 70 + hash(m, iz, 44) * 110;
    return isClear(x, z, r + 30) ? { x, z, r: r * .95, R: r, hgt: 60 + hash(m, iz, 45) * 100, m, iz, kind: "mesa" } : null;
  }
  function boulderAt(ix, iz) { // solid rocks to steer around
    const m = wrapI(ix, 300); if (hash(m, iz, 51) > .3) return null;
    const x = (ix + .2 + .6 * hash(m, iz, 52)) * 300, z = (iz + .2 + .6 * hash(m, iz, 53)) * 300, r = 13 + hash(m, iz, 54) * 12;
    return isClear(x, z, r) ? { x, z, r, m, iz, kind: "boulder" } : null;
  }
  function sandAt(ix, iz) { // soft sand that slows the rover down
    const m = wrapI(ix, 600); if (hash(m, iz, 61) > .36) return null;
    const x = (ix + .2 + .6 * hash(m, iz, 62)) * 600, z = (iz + .2 + .6 * hash(m, iz, 63)) * 600, r = 70 + hash(m, iz, 64) * 50;
    return isClear(x, z, r) ? { x, z, r, m, iz, kind: "sand" } : null;
  }
  function craterAt(ix, iz) { const c = craterCell(ix, iz, 900, .25, 40, 110); return c ? { x: (ix + c.fx) * 900, z: (iz + c.fz) * 900, r: c.r, kind: "crater" } : null; }
  function gather(fn, cell, cx, cz, reach, out) { const a = Math.round(cx / cell), b = Math.round(cz / cell), n = Math.ceil(reach / cell); for (let ix = a - n; ix <= a + n; ix++) for (let iz = b - n; iz <= b + n; iz++) { const o = fn(ix, iz); if (o) out.push(o); } return out; }
  let solids = [], sands = [];
  function collectObstacles(cx, cz) {
    const solids = [], sands = []; if (worldKey === "moon") return { solids, sands }; // the Moon is the easy level: nothing blocks the rover there
    gather(mesaAt, 900, cx, cz, 2700, solids); gather(boulderAt, 300, cx, cz, 1500, solids); gather(craterAt, 900, cx, cz, 1800, solids);
    gather(sandAt, 600, cx, cz, 1800, sands);
    return { solids, sands };
  }
  const boulders = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), new T.MeshLambertMaterial({ flatShading: true }), 160);
  prepareInstanceColors(boulders, T);
  boulders.castShadow = true; boulders.frustumCulled = false; scene.add(boulders);
  const rimGeo = new T.TorusGeometry(1, .16, 5, 28); rimGeo.rotateX(Math.PI / 2);
  const rims = new T.InstancedMesh(rimGeo, new T.MeshLambertMaterial({ color: 0x9c4426, flatShading: true }), 40); // raised crater rims you can see coming
  rims.castShadow = true; rims.frustumCulled = false; rims.count = 0; scene.add(rims);
  const ripples = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: 0x7c3520, flatShading: true }), 700);
  ripples.frustumCulled = false; scene.add(ripples);

  function updateProps(cx, cz) {
    const moon = worldKey === "moon"; let n = 0;
    const c0 = Math.round(cx / 90), z0 = Math.round(cz / 90), dens = moon ? .16 : .42, big = moon ? 3 : 4; // just a few small rocks on the Moon
    for (let ix = c0 - 11; ix <= c0 + 11; ix++) for (let iz = z0 - 11; iz <= z0 + 11; iz++) {
      const m = wrapI(ix, 90); if (hash(m, iz, 31) > dens || n >= 520) continue;
      const px = (ix + hash(m, iz, 32)) * 90, pz = (iz + hash(m, iz, 33)) * 90, q = hash(m, iz, 34), s = 1.4 + q * q * big;
      if (sites.some(t => Math.hypot(wdx(t.x - px), t.y - pz) < 70)) continue;
      dummy.position.set(px, H(px, pz) + s * .25, pz); dummy.rotation.set(q * 6, q * 40, q * 17); dummy.scale.set(s, s * .75, s * (.8 + q * .5)); dummy.updateMatrix();
      rocks.setMatrixAt(n, dummy.matrix);
      const v = .8 + hash(m, iz, 35) * .35; rocks.setColorAt(n, moon ? tmpC.setRGB(.5 * v, .5 * v, .54 * v) : tmpC.setRGB(.62 * v, .3 * v, .2 * v)); n++;
    }
    rocks.count = n; rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;

    let nm = 0, nb = 0, nr = 0, nc = 0; mesaLandmarks.arches.count = 0;
    for (const o of solids) {
      if (o.kind === "mesa" && nm < 60) {
        dummy.position.set(o.x, H(o.x, o.z) - 20, o.z); dummy.rotation.set(0, hash(o.m, o.iz, 46) * 6, 0); dummy.scale.set(o.R, o.hgt + 20, o.R * (.7 + hash(o.m, o.iz, 47) * .5)); dummy.updateMatrix();
        mesas.setMatrixAt(nm, dummy.matrix); const v = .85 + hash(o.m, o.iz, 48) * .3; mesas.setColorAt(nm, tmpC.setRGB(.7 * v, .33 * v, .2 * v));
        positionMesaLandmark(mesaLandmarks, o, nm, H(o.x, o.z), hash(o.m, o.iz, 46) * 6, .7 + hash(o.m, o.iz, 47) * .5, v); nm++;
      } else if (o.kind === "crater" && nc < 40) {
        let lo = 1e9; for (let a = 0; a < 6.3; a += .8) lo = Math.min(lo, H(o.x + Math.cos(a) * o.r, o.z + Math.sin(a) * o.r));
        dummy.position.set(o.x, lo + o.r * .04, o.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(o.r * 1.02, o.r * .9, o.r * 1.02); dummy.updateMatrix(); rims.setMatrixAt(nc++, dummy.matrix);
      } else if (o.kind === "boulder" && nb < 160) {
        const q = hash(o.m, o.iz, 55); dummy.position.set(o.x, H(o.x, o.z) + o.r * .3, o.z); dummy.rotation.set(q * 5, q * 30, q * 11); dummy.scale.set(o.r * 1.05, o.r * (.8 + q * .3), o.r * 1.05); dummy.updateMatrix();
        boulders.setMatrixAt(nb, dummy.matrix); const v = .8 + q * .3; boulders.setColorAt(nb++, tmpC.setRGB(.47 * v, .2 * v, .15 * v));
      }
    }
    for (const sd of sands) for (let k = -3; k <= 3; k++) { // wavy ripple lines across each sand patch
      const off = k * sd.r * .26, half = Math.sqrt(Math.max(0, sd.r * sd.r * .85 - off * off));
      for (let seg = -1; seg <= 1 && nr < 700; seg++) {
        const lx = seg * half * .66, x = sd.x + lx, z = sd.z + off + Math.sin(lx * .05 + k) * 5;
        dummy.position.set(x, H(x, z) + .5, z); dummy.rotation.set(0, Math.cos(lx * .05 + k) * .2, 0); dummy.scale.set(half * .68, 1, 3.2); dummy.updateMatrix(); ripples.setMatrixAt(nr++, dummy.matrix);
      }
    }
    mesaLandmarks.bands.count = nm * 3; mesaLandmarks.caps.count = nm;
    for (const mesh of [mesaLandmarks.bands, mesaLandmarks.caps, mesaLandmarks.arches]) {
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesas.count = nm; mesas.instanceMatrix.needsUpdate = true; if (mesas.instanceColor) mesas.instanceColor.needsUpdate = true;
    rims.count = nc; rims.instanceMatrix.needsUpdate = true;
    boulders.count = nb; boulders.instanceMatrix.needsUpdate = true; if (boulders.instanceColor) boulders.instanceColor.needsUpdate = true;
    ripples.count = nr; ripples.instanceMatrix.needsUpdate = true;
  }
  // Can every ghost and star be reached from the start? Flood-fills a grid of the whole map around the solid obstacles. (Used by tests.)
  function reachable() {
    const g = 30, gw = Math.ceil(W.w / g), gh = Math.ceil(W.h / g), blocked = new Uint8Array(gw * gh), all = [];
    gather(mesaAt, 900, W.w / 2, W.h / 2, Math.max(W.w, W.h) / 2 + 900, all); gather(boulderAt, 300, W.w / 2, W.h / 2, Math.max(W.w, W.h) / 2 + 300, all); gather(craterAt, 900, W.w / 2, W.h / 2, Math.max(W.w, W.h) / 2 + 900, all);
    if (worldKey === "moon") all.length = 0;
    for (const o of all) { const R = o.r + 20, n = Math.ceil(R / g); for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) { if (Math.hypot(a, b) * g > R) continue; let gx = Math.floor(o.x / g) + a; const gy = Math.floor(o.z / g) + b; if (WD.wrap) gx = ((gx % gw) + gw) % gw; if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) blocked[gy * gw + gx] = 1; } }
    const seen = new Uint8Array(gw * gh), [sx, sy] = toXY(WD.start[0], WD.start[1]), cell = (x, y) => Math.floor(y / g) * gw + ((Math.floor(x / g) % gw) + gw) % gw, q = [cell(sx, sy)]; seen[q[0]] = 1;
    while (q.length) { const c = q.pop(), x = c % gw, y = (c - x) / gw; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { let nx = x + dx; const ny = y + dy; if (WD.wrap) nx = (nx + gw) % gw; if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue; const k = ny * gw + nx; if (!seen[k] && !blocked[k]) { seen[k] = 1; q.push(k); } } }
    return { obstacles: all.length, ghosts: sites.map(s => [s.id, !!seen[cell(s.x, s.y)]]), stars: stars.map(s => [s.id, !!seen[cell(s.x, s.y)]]) };
  }

  // ------------------------------------------------------------------
  // sky: dome, stars, Earth, Sun, far-away hills
  // ------------------------------------------------------------------
  const skyGeo = new T.SphereGeometry(20000, 24, 16);
  skyGeo.setAttribute("color", new T.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new T.Mesh(skyGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);
  function paintSky(zenith, horizon, ground) {
    const p = skyGeo.attributes.position, c = skyGeo.attributes.color, a = new T.Color(zenith), b = new T.Color(horizon), g = new T.Color(ground);
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 20000; if (y < -.005) tmpC.copy(g); else tmpC.copy(b).lerp(a, Math.pow(clamp(y, 0, 1), .55)); c.setXYZ(i, tmpC.r, tmpC.g, tmpC.b); }
    c.needsUpdate = true;
  }
  const starPts = (() => {
    const n = 1400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 * Math.PI, y = Math.random() * .98 + .02, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(u) * r * 15000, y * 15000, Math.sin(u) * r * 15000], i * 3);
      const v = .5 + Math.random() * .5; col.set([v, v, v * (1 + Math.random() * .15)], i * 3);
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("color", new T.BufferAttribute(col, 3));
    const pts = new T.Points(g, new T.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
    pts.renderOrder = -9; scene.add(pts); return pts;
  })();
  function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new T.CanvasTexture(c); return t; }
  const glowTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  const sunTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "#fff"); r.addColorStop(.16, "#fff"); r.addColorStop(.2, "rgba(255,255,255,.4)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  // A cartoon Earth, drawn here in code (not a photo)
  const earthTex = canvasTex(256, 256, (g) => {
    g.beginPath(); g.arc(128, 128, 120, 0, 7); g.clip();
    g.fillStyle = "#2f7fe0"; g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#4fc26a"; [[90, 90, 46, 34], [150, 150, 40, 52], [60, 170, 26, 20], [185, 80, 30, 22], [120, 215, 34, 14]].forEach(([x, y, a, b], i) => { g.beginPath(); g.ellipse(x, y, a, b, i * .9, 0, 7); g.fill(); });
    g.fillStyle = "rgba(255,255,255,.85)"; [[70, 60, 50, 9], [160, 110, 60, 10], [100, 150, 44, 8], [170, 195, 50, 9], [128, 18, 70, 12], [128, 240, 70, 12]].forEach(([x, y, a, b], i) => { g.beginPath(); g.ellipse(x, y, a, b, -.2 + i * .13, 0, 7); g.fill(); });
    const s = g.createRadialGradient(80, 90, 40, 128, 128, 150); s.addColorStop(0, "rgba(0,0,30,0)"); s.addColorStop(.7, "rgba(0,0,30,.15)"); s.addColorStop(1, "rgba(0,0,30,.75)"); g.fillStyle = s; g.fillRect(0, 0, 256, 256);
  });
  const sprite = (map, o) => { const s = new T.Sprite(new T.SpriteMaterial(Object.assign({ map, fog: false, depthWrite: false, transparent: true }, o))); scene.add(s); return s; };
  const earth = sprite(earthTex, {}); earth.scale.set(1500, 1500, 1); earth.renderOrder = -8;
  const earthGlow = sprite(glowTex, { color: 0x6fb4ff, opacity: .35, blending: T.AdditiveBlending }); earthGlow.scale.set(3200, 3200, 1); earthGlow.renderOrder = -8.5;
  const sunSp = sprite(sunTex, { blending: T.AdditiveBlending }); sunSp.renderOrder = -8;
  const earthDir = new T.Vector3(0, .25, 1).normalize();

  function ridge(radius, seg, fn, top, bottom) { // a ring of far-away hills that follows the camera
    const pos = [], col = [], idx = [], a = new T.Color(top), b = new T.Color(bottom);
    for (let i = 0; i <= seg; i++) {
      const u = i / seg * Math.PI * 2, x = Math.cos(u) * radius, z = Math.sin(u) * radius, h = fn(i % seg, seg);
      pos.push(x, -260, z, x, h, z); col.push(b.r, b.g, b.b, lerp(b.r, a.r, h / 260), lerp(b.g, a.g, h / 260), lerp(b.b, a.b, h / 260));
      if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new T.BufferGeometry(); g.setIndex(idx); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false })); m.frustumCulled = false; m.renderOrder = -5; return m;
  }
  function createHorizonLandmarks(T, moon) {
    const group = new T.Group(); group.name = moon ? "Distant crater silhouettes" : "Distant stone arch silhouettes";
    const material = new T.MeshBasicMaterial({ color: moon ? 0x8e99b3 : 0xc68e71, fog: false, side: T.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const a = [-2.25, -.42, 1.48][i], radius = 1760;
      const geometry = moon ? new T.TorusGeometry(1, .14, 4, 20) : mesaArchGeometry(T);
      if (moon) geometry.rotateX(Math.PI / 2);
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(Math.cos(a) * radius, moon ? 8 + i * 3 : 30 + i * 12, Math.sin(a) * radius);
      mesh.rotation.set(0, Math.PI / 2 - a, moon ? .025 * (i - 1) : 0);
      mesh.scale.set(moon ? 180 + i * 20 : 115 + i * 14, moon ? 110 : 100 + i * 10, moon ? 70 : 85);
      mesh.renderOrder = -4; mesh.frustumCulled = false; group.add(mesh);
    }
    return group;
  }
  const loopNoise = (i, n, cell, seed) => { const f = i / cell, a = Math.floor(f), k = smooth(f - a), p = Math.round(n / cell); return lerp(hash(a % p, 0, seed), hash((a + 1) % p, 0, seed), k); };
  let ridges = [];

  // ------------------------------------------------------------------
  // particles (dust and sparkles)
  // ------------------------------------------------------------------
  function Particles(n, additive) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
    const vel = new Float32Array(n * 3), life = new Float32Array(n), max = new Float32Array(n), par = new Float32Array(n * 5); // gravity, drag, grow, alpha, floor
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("aCol", new T.BufferAttribute(col, 4)); g.setAttribute("aSize", new T.BufferAttribute(size, 1));
    const mat = new T.ShaderMaterial({
      uniforms: { uScale: { value: 500 } }, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
      vertexShader: "attribute float aSize; attribute vec4 aCol; varying vec4 vCol; uniform float uScale; void main(){ vCol=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "varying vec4 vCol; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5," + (additive ? "0.05" : "0.3") + ",d); if(a<0.01) discard; gl_FragColor=vec4(vCol.rgb,vCol.a*a); }"
    });
    const pts = new T.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
    let next = 0;
    return {
      mat,
      emit(x, y, z, vx, vy, vz, lf, sz, r, gg, b, a, grav, drag, grow, floor) {
        const i = next; next = (next + 1) % n;
        pos.set([x, y, z], i * 3); vel.set([vx, vy, vz], i * 3); col.set([r, gg, b, a], i * 4); size[i] = sz; life[i] = max[i] = lf;
        par.set([grav || 0, drag || 0, grow || 0, a, floor == null ? -1e9 : floor], i * 5);
      },
      update(dt) {
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt; const p = i * 3, q = i * 5;
          vel[p + 1] -= par[q] * dt; const dr = Math.max(0, 1 - par[q + 1] * dt); vel[p] *= dr; vel[p + 1] *= dr; vel[p + 2] *= dr;
          pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt; size[i] += par[q + 2] * dt;
          if (life[i] <= 0 || pos[p + 1] < par[q + 4]) { life[i] = 0; size[i] = 0; col[i * 4 + 3] = 0; }
          else col[i * 4 + 3] = par[q + 3] * Math.min(1, life[i] / max[i] * 2.5);
        }
        g.attributes.position.needsUpdate = g.attributes.aCol.needsUpdate = g.attributes.aSize.needsUpdate = true;
      },
      clear() { life.fill(0); size.fill(0); }
    };
  }
  const dust = Particles(700, false), spark = Particles(700, true);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const emissionCarry = new Map();
  function emissionCount(key, rate, dt) {
    if (rate <= 0) { emissionCarry.delete(key); return 0; }
    const amount = (emissionCarry.get(key) || 0) + rate * dt, count = Math.floor(amount + 1e-9);
    emissionCarry.set(key, Math.max(0, amount - count)); return count;
  }

  // ------------------------------------------------------------------
  // the player's rover, its tracks, dust devils
  // ------------------------------------------------------------------
  const R = Models.playerRover(store.get("color", ROVER_COLORS[1][1]));
  R.group.rotation.order = "YZX"; scene.add(R.group);
  let bodyOff = 0, bodyVel = 0, wheelSpin = 0, blink = 2;

  // The tyres have six straight crosswise blocks, so each impression uses
  // the same width, contact length and rolling pitch as the actual wheel.
  const tread = R.wheels[0].userData.tread;
  const trackGeo = new T.PlaneGeometry(tread.width, tread.length); trackGeo.rotateX(-Math.PI / 2);
  const TRN = 2400, trackLife = new Float32Array(TRN), trackFade = new Float32Array(TRN);
  trackGeo.setAttribute("aFade", new T.InstancedBufferAttribute(trackFade, 1));
  const trackMat = new T.ShaderMaterial({
    uniforms: { ink: { value: new T.Color(0x302436) } },
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: "attribute float aFade; varying float vFade; void main(){vFade=aFade; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}",
    fragmentShader: "uniform vec3 ink; varying float vFade; void main(){float a=vFade*.24; if(a<.005) discard; gl_FragColor=vec4(ink,a);}"
  });
  const tracks = new T.InstancedMesh(trackGeo, trackMat, TRN);
  tracks.frustumCulled = false; tracks.count = 0; scene.add(tracks);
  const trackDummy = new T.Object3D();
  let trackI = 0, trackLast = [1e9, 1e9];
  function resetTracks() {
    trackI = 0; tracks.count = 0; trackLast = [1e9, 1e9]; trackLife.fill(0); trackFade.fill(0);
    trackGeo.attributes.aFade.needsUpdate = true;
  }
  function updateTracks(dt) {
    if (mode === "pause" || bookOpen) return;
    let dirty = false;
    for (let i = 0; i < tracks.count; i++) if (trackLife[i] > 0) {
      trackLife[i] = Math.max(0, trackLife[i] - dt);
      trackFade[i] = smooth(Math.min(1, trackLife[i] / 9)); dirty = true;
    }
    if (dirty) trackGeo.attributes.aFade.needsUpdate = true;
  }
  function layTrack() {
    const dx = rover.x - trackLast[0], dz = rover.y - trackLast[1], distance = Math.hypot(dx, dz);
    if (distance < tread.pitch) return;
    // Fill the distance travelled between frames, keeping rib spacing steady
    // at any speed. A fresh trail or teleport starts at the current position.
    const fresh = distance > 150, count = fresh ? 1 : Math.floor(distance / tread.pitch);
    const c = Math.cos(rover.h), s = Math.sin(rover.h);
    const axle = (rover.v < 0 ? Math.max : Math.min)(...R.wheels.map(w => w.userData.x));
    let px = rover.x, pz = rover.y;
    for (let step = 1; step <= count; step++) {
      px = fresh ? rover.x : trackLast[0] + dx * (step * tread.pitch / distance);
      pz = fresh ? rover.y : trackLast[1] + dz * (step * tread.pitch / distance);
      for (const wheel of R.wheels) {
        if (wheel.userData.x !== axle) continue;
        const side = wheel.userData.z;
        const x = px - s * side + c * axle, z = pz + c * side + s * axle;
        const f = H(x + c * 3, z + s * 3), b = H(x - c * 3, z - s * 3);
        trackDummy.position.set(x, H(x, z) + .5, z); trackDummy.rotation.set(-Math.atan2(f - b, 6), Math.PI / 2 - rover.h, 0, "YXZ"); trackDummy.scale.set(1, 1, 1); trackDummy.updateMatrix();
        const index = trackI % TRN; tracks.setMatrixAt(index, trackDummy.matrix); trackLife[index] = 14; trackFade[index] = 1; trackI++;
      }
    }
    trackLast = [px, pz];
    tracks.count = Math.min(TRN, trackI); tracks.instanceMatrix.needsUpdate = true;
    trackGeo.attributes.aFade.needsUpdate = true;
  }

  const devils = [];
  { const m = new T.MeshBasicMaterial({ color: 0xe9b98a, transparent: true, opacity: .2, side: T.DoubleSide, depthWrite: false });
    for (let k = 0; k < 4; k++) {
      const g = new T.Group(); g.userData = { x: 0, z: 0, seed: k * 7.3, far: true };
      for (let i = 0; i < 7; i++) { const r = 5 + i * 3.4, c = new T.Mesh(new T.CylinderGeometry(r + 3.6, r, 24, 9, 1, true), m); c.position.y = 12 + i * 23; g.add(c); }
      scene.add(g); devils.push(g);
    } }

  // ------------------------------------------------------------------
  // things that belong to one world: ghosts, science stars, place names
  // ------------------------------------------------------------------
  let worldGroup = new T.Group(); scene.add(worldGroup);
  function textSprite(text, o) {
    const c = document.createElement("canvas"), g = c.getContext("2d"), fs = 64, font = "700 " + fs + "px Fredoka, ui-rounded, system-ui, sans-serif";
    g.font = font; const w = Math.ceil(g.measureText(text).width) + 50; c.width = w; c.height = 100;
    g.font = font; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = 16; g.strokeStyle = o.stroke || "#141a3c"; g.strokeText(text, w / 2, 52);
    g.fillStyle = o.color || "#fff"; g.fillText(text, w / 2, 52);
    const s = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false, fog: o.fog !== false, opacity: o.opacity || 1 }));
    s.scale.set(o.h * w / 100, o.h, 1); return s;
  }
  const beamTex = canvasTex(4, 256, (g) => { const r = g.createLinearGradient(0, 256, 0, 0); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.5)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 4, 256); });
  const beamGeo = new T.CylinderGeometry(1, 1, 1, 14, 1, true); beamGeo.translate(0, .5, 0);
  const ringGeo = new T.RingGeometry(.86, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  const starGeo = Models.starGeo(10, 4.6, 4), starMat = new T.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xb07a00, flatShading: true });

  function buildWorld() {
    scene.remove(worldGroup);
    Models.dispose(worldGroup, { geometries: [beamGeo, ringGeo, starGeo], materials: [starMat], textures: [beamTex, glowTex] });
    terrainJob = null; terrain.visible = false; tcx = 1e9;
    solids = []; sands = [];
    [rocks, mesas, boulders, rims, ripples, mesaLandmarks.bands, mesaLandmarks.caps, mesaLandmarks.arches].forEach(mesh => mesh.count = 0);
    worldGroup = new T.Group(); scene.add(worldGroup);
    sites = WD.sites.map(s => { const [x, y] = toXY(s.lat, s.lon); return Object.assign({}, s, { x, y }); });
    stars = WD.stars.map(([lat, lon, fact], i) => { const [x, y] = toXY(lat, lon); return { id: worldKey + i, x, y, fact }; });
    { const [sx, sy] = toXY(WD.start[0], WD.start[1]); clearPts = sites.map(s => ({ x: s.x, y: s.y, r: 230 })).concat(stars.map(s => ({ x: s.x, y: s.y, r: 90 })), [{ x: sx, y: sy, r: 260 }]); craterMemo = new Map(); }
    for (const s of sites) s.h0 = rawH(s.x, s.y);
    for (const s of sites) {
      const g = new T.Group(); g.position.set(s.x, s.h0, s.y); worldGroup.add(g); s.g = g;
      s.model = Models.hardware(s.type, s); s.model.scale.setScalar(1.3); s.model.rotation.y = hash(s.lat * 100 | 0, 3, 5) * 6; g.add(s.model);
      const bm = () => new T.MeshBasicMaterial({ map: beamTex, color: 0x59d8ff, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
      s.beam = new T.Mesh(beamGeo, bm()); s.beam.scale.set(9, 1700, 9); g.add(s.beam);
      s.core = new T.Mesh(beamGeo, bm()); s.core.material.color.set(0xffffff); s.core.scale.set(2.2, 1700, 2.2); g.add(s.core);
      s.ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0x59d8ff, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })); s.ring.position.y = 1.5; g.add(s.ring);
      s.q = textSprite("?", { h: 34, color: "#59d8ff", fog: false }); s.q.position.y = 78; g.add(s.q);
      s.tag = textSprite(s.name, { h: 11, color: "#ffd23f" }); s.tag.position.y = 66; g.add(s.tag);
      s.light = new T.PointLight(0x59d8ff, 1.2, 260, 1.5); s.light.position.y = 30; g.add(s.light);
      setSiteAlive(s, found.has(s.id));
    }
    for (const s of stars) {
      const g = new T.Group(); worldGroup.add(g); s.g = g; s.h0 = H(s.x, s.y);
      s.mesh = new T.Mesh(starGeo, starMat); g.add(s.mesh);
      const gl = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffd23f, transparent: true, opacity: .55, blending: T.AdditiveBlending, depthWrite: false })); gl.scale.set(60, 60, 1); g.add(gl);
      g.visible = !starsGot.has(s.id);
    }
    labels = WD.labels.map(([name, lat, lon]) => {
      const [x, y] = toXY(lat, lon), sp = textSprite(name, { h: 44, opacity: .85 }); sp.position.set(x, H(x, y) + 150, y); worldGroup.add(sp); return { x, sp };
    });
  }
  function setSiteAlive(s, alive) {
    s.alive = alive; Models.setHolo(s.model, !alive);
    s.beam.visible = s.core.visible = s.ring.visible = s.q.visible = !alive; s.light.visible = !alive;
  }

  function setWorld(k) {
    discoveryFx.cancel();
    worldKey = k; WD = WORLDS[k]; W = { w: (WD.lonMax - WD.lonMin) * WD.ppd, h: (WD.latMax - WD.latMin) * WD.ppd };
    sites = []; buildWorld();
    [rover.x, rover.y] = toXY(WD.start[0], WD.start[1]);
    Object.assign(rover, { v: 0, h: -Math.PI / 2, vy: 0, air: false, boost: 0, alt: H(rover.x, rover.y) }); rover.gPrev = rover.alt; camH = rover.h;
    resetTracks(); dust.clear(); spark.clear(); emissionCarry.clear(); tcx = 1e9; lastPing = -1;
    const moon = k === "moon";
    // the look of each world
    if (moon) {
      scene.fog = new T.Fog(0x55565c, 800, 1780); paintSky(0x000000, 0x000000, 0x55565c);
      hemi.color.set(0xb3c3f4); hemi.groundColor.set(0x30334e); hemi.intensity = .52; sun.color.set(0xfff8e9); sun.intensity = 1.04; fill.color.set(0xaecbff); fill.intensity = .15; sunDir.set(-.72, .36, .6).normalize();
      sunSp.material.color.set(0xffffff); sunSp.scale.set(2600, 2600, 1);
    } else {
      scene.fog = new T.Fog(0xe9b990, 500, 1780); paintSky(0xb9825a, 0xf2c79c, 0xe9b990);
      hemi.color.set(0xffe9d2); hemi.groundColor.set(0x6c4f68); hemi.intensity = .62; sun.color.set(0xfff3df); sun.intensity = .8; fill.color.set(0xb9ceff); fill.intensity = .12; sunDir.set(-.5, .62, .6).normalize();
      sunSp.material.color.set(0xfff3d6); sunSp.scale.set(1700, 1700, 1);
    }
    // holograms glow (additive) against the black lunar sky, but need solid colour to show up against the bright Mars sky
    const blend = moon ? T.AdditiveBlending : T.NormalBlending;
    Models.holoFace.blending = Models.holoLine.blending = blend; Models.holoFace.color.set(moon ? 0x59d8ff : 0x19b6ff); Models.holoLine.color.set(moon ? 0xaef1ff : 0xe8fbff);
    Models.holoFace.needsUpdate = Models.holoLine.needsUpdate = true;
    for (const st of sites) { [st.beam, st.core, st.ring].forEach(m => { m.material.blending = blend; m.material.needsUpdate = true; }); st.beam.material.color.set(moon ? 0x59d8ff : 0x12a8ff); }
    starPts.visible = earth.visible = earthGlow.visible = moon;
    devils.forEach(d => { d.visible = !moon; d.userData.far = true; });
    ridges.forEach(r => { scene.remove(r); Models.dispose(r); });
    ridges = moon
      ? [ridge(1790, 180, (i, n) => 40 + loopNoise(i, n, 15, 3) * 130 + loopNoise(i, n, 4, 4) * 30, 0xa9abb4, 0x55565c),
         ridge(1770, 180, (i, n) => 15 + loopNoise(i, n, 9, 5) * 70 + loopNoise(i, n, 3, 6) * 14, 0x7c7e87, 0x55565c)]
      : [ridge(1790, 180, (i, n) => 60 + loopNoise(i, n, 12, 7) * 190 + loopNoise(i, n, 3, 8) * 40, 0xd29a78, 0xe9b990),
         ridge(1770, 180, (i, n) => 20 + (loopNoise(i, n, 10, 9) > .55 ? 85 + loopNoise(i, n, 30, 10) * 50 : loopNoise(i, n, 5, 11) * 40), 0xb8663f, 0xe9b990)];
    ridges.push(createHorizonLandmarks(T, moon));
    ridges.forEach(r => scene.add(r));
    Icons.label($("hudWorld"), moon ? "moon" : "mars", WD.label);
    setupMini();
    document.querySelectorAll(".pick").forEach(b => b.classList.toggle("on", b.dataset.world === k));
    if (mode !== "lobby") Sfx.music(k);
    padLight(); showClock();
    updateHud();
  }
  function nearestUnfound() {
    let best = null, bd = Infinity;
    for (const s of sites) if (!found.has(s.id)) { const d = Math.hypot(wdx(s.x - rover.x), s.y - rover.y); if (d < bd) { bd = d; best = s; } }
    return best ? { s: best, d: bd } : null;
  }

  // ------------------------------------------------------------------
  // input and actions (keyboard, game controller and on-screen buttons all end up here)
  // ------------------------------------------------------------------
  // Keyboard. On menus and cards the arrow keys move between buttons and Enter presses the chosen one.
  const GAME_KEYS = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " ", "enter", "escape", "m", "r", "b", "n", "p"]);
  const MENU_DIR = { arrowleft: -1, arrowup: -1, arrowright: 1, arrowdown: 1 };
  addEventListener("keydown", e => {
    const k = e.key.toLowerCase(), target = e.target;
    // Keep native form controls and text selection usable inside settings.
    if (target && ((target.matches && target.matches("input,select,textarea")) || target.isContentEditable)) {
      if (k === "escape") { e.preventDefault(); action("back"); }
      return;
    }
    keys[k] = true; Sfx.init();
    const overlay = overlayNow(), menu = !!overlay && (mode !== "task" || graphicsBlocked);
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "enter"].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (GAME_KEYS.has(k)) setCtrl("kb");
    if (menu && k in MENU_DIR) { moveFocus(MENU_DIR[k]); return; }
    if (k === "enter" || k === " ") GameUI.activateFocused(overlay, () => action("next"));
    if (k === "m") action("world");
    if (k === "r") action("read");
    if (k === "b") action("book");
    if (k === "n") action("mute");
    if (k === "p") action("pause");
    if (k === "escape") action("back");
  });
  addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
  function clearHeldInput() {
    for (const k in keys) delete keys[k];
    kbSteer = 0; rover.steer = 0; taskPulse = 0; pad = null;
    if (typeof phoneState !== "undefined") phoneState = null;
    if (typeof phoneLink !== "undefined" && phoneLink) phoneLink.clear();
    if (Tasks.inp) Object.assign(Tasks.inp, { hold: false, press: false, mouseHold: false, x: 0 });
  }
  function pauseForFocusLoss() {
    clearHeldInput(); stopReading();
    if (mode === "play" || mode === "task" || mode === "count") openPause("The game paused while you were away. Resume when you're ready.");
  }
  addEventListener("blur", pauseForFocusLoss);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseForFocusLoss(); });
  addEventListener("pointerdown", () => Sfx.init());
  // All connected inputs remain usable: strongest steering and pedal presses win.
  let pad = null, ctrlNow = "kb", kbSteer = 0;
  let phoneState = null, phoneMission = null;
  const phoneLink = typeof PhoneLink === "undefined" ? null : PhoneLink.createHost({ onDisconnect: phoneDisconnected });
  function phoneDisconnected(message) {
    phoneState = null;
    if (phoneMission) {
      const originalHint = phoneMission.desktopHint;
      phoneMission = null; phoneLink.clearMission();
      if (typeof originalHint === "string") $("taskHint").textContent = originalHint;
      const task = document.getElementById("task"); if (task) task.classList.remove("remote-phone-task");
      lostInput("Phone disconnected. Resume to restart this mission task on the computer.");
      return;
    }
    if (ctrlNow === "phone") lostInput(message || "The phone disconnected. Reconnect it, or keep going with the keyboard or a controller.");
  }
  function updateKb(dt) { // keyboard steering eases in over about a third of a second, so it isn't twitchy, and lets go quickly
    const t = (keys.arrowleft || keys.a ? -1 : 0) + (keys.arrowright || keys.d ? 1 : 0);
    const rate = t !== 0 && (kbSteer === 0 || Math.sign(t) === Math.sign(kbSteer)) && Math.abs(t) > Math.abs(kbSteer) ? 3.2 : 8;
    kbSteer += clamp(t - kbSteer, -rate * dt, rate * dt);
  }

  // ---- mission tasks: a short hands-on job when a ghost wakes up, before its story card ----
  let taskSite = null, taskPulse = 0; const tasksDone = new Set();
  const taskSfx = { done: () => Sfx.found(), snap: () => Sfx.star(), bump: () => Sfx.bump(.3) };
  function startTask(st, replay = false, taskWorld = worldKey) {
    if (!Tasks.has(st.id)) { openCard(st, replay ? "review" : "site"); return; }
    if (!replay) { pendingSite = st.id; pendingPhase = "task"; }
    mode = "task"; taskSite = st; rover.v = 0; $("toast").classList.remove("show"); toastT = 0; Tasks.has(st.id) && setTimeout(refreshPrompts, 0);
    if (phoneMission && phoneLink) phoneLink.clearMission();
    phoneMission = null;
    Tasks.start(st.id, { world: taskWorld, sfx: n => (taskSfx[n] || (() => { }))(), buzz: k => Pad.rumble(k),
      onEnd: ok => {
        if (phoneMission && phoneLink) phoneLink.clearMission();
        phoneMission = null;
        const task = document.getElementById("task"); if (task) task.classList.remove("remote-phone-task");
        taskSite = null;
        if (ok) {
          const first = !tasksDone.has(st.id); tasksDone.add(st.id);
          if (first) {
            const activeClock = clock.on && !clock.free[taskWorld];
            if (activeClock && taskWorld === worldKey) addTime(10, true);
            else if (activeClock) clock.left[taskWorld] += 10;
            toast(activeClock ? "Bonus science star for finishing the task! +10s" : "Task sticker earned!", "Mission task done ✓", "🛠");
          } else toast("Great work, explorer!", "Mission task done ✓", "🛠");
        }
        if (!replay) pendingPhase = "story";
        saveProgress();
        openCard(st, replay ? "review" : "site");
      } });
    const readyPhone = phoneLink && phoneLink.sample();
    if (readyPhone && readyPhone.taskReady && typeof phoneLink.setMission === "function") {
      phoneMission = { id: st.id, world: taskWorld, desktopHint: $("taskHint").textContent, runId: st.id + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2), paused: false };
      phoneLink.setMission(phoneMission); setCtrl("phone");
      const task = document.getElementById("task"); if (task) task.classList.add("remote-phone-task");
      $("taskHint").textContent = "This mission is running on your phone. Follow its touch controls to complete it.";
      $("taskAction").textContent = "Pick up your phone · your rover and mission timer are waiting here.";
    }
  }
  function stepTask(dt) { // the task uses the same controls as driving: steer moves the pointer, drive (or Enter, or Cross) grabs
    if (typeof phoneMission !== "undefined" && phoneMission) {
      const result = phoneState && phoneState.missionResult;
      if (result && result.runId === phoneMission.runId) {
        phoneMission = null; phoneLink.ackMission(result.runId); Tasks.finish(result.ok);
      }
      return;
    }
    const i = input(); taskPulse -= dt;
    Tasks.step(dt, { x: i.s, hold: i.g > 0 || keys.enter || keys[" "] || (pad && pad.down.cross) || (phoneState && phoneState.down.cross) || taskPulse > 0 });
  }

  // ---- button prompts follow the active input ----
  function setCtrl(kind) { if (kind !== ctrlNow) { ctrlNow = kind; refreshPrompts(); } }
  function refreshPrompts() {
    const k = ctrlNow, style = k === "phone" ? "pad" : k, P = Prompts, key = P.key, set = (id, act) => { const el = $(id); if (el) el.dataset.key = act ? P.label(k, act) : ""; };
    document.querySelectorAll(".way").forEach(w => w.classList.toggle("on", w.dataset.way === k));
    set("cardNext", "next"); set("cardRead", "read"); set("reportKeep", "next"); set("kbStart", "next"); set("howClose", "next"); set("pauseResume", "next");
    set("bookClose", "back"); set("taskSkip", "skip");
    const cardAction = cardKind === "review" ? "Back to sticker book" : cardKind === "deep" ? "Next signal" : cardKind === "end" ? "Back to title" : cardKind === "world" ? "Next destination" : "Keep exploring";
    const html = {
      card: { pad: P.line(k, [["next", cardAction], ["read", "Read aloud"], ["back", "Close"]]), kb: P.line(k, [["next", cardAction], ["read", "Read aloud"], ["back", "Close"]]) },
      task: { pad: key(k === "phone" ? "Tilt phone" : "Left stick") + " move the hand · hold " + key(P.label(k, "next")) + " to grab · " + key(P.label(k, "back")) + " skip", kb: key("←") + " " + key("→") + " move the hand · hold " + key("Enter") + " to grab · " + key("Esc") + " skip" },
      report: { pad: P.line(k, [["next", "Keep exploring"]]) + " · " + key(k === "phone" ? "Arrow buttons" : "D-pad") + " choose a button", kb: P.line(k, [["next", "Keep exploring"]]) + " · " + key("←") + " " + key("→") + " choose a button" },
      book: { pad: key(P.label(k, "back")) + " or " + key(P.label(k, "book")) + " close", kb: key("Esc") + " or " + key("B") + " close" },
      pause: { pad: key(P.label(k, "next")) + " or " + key(P.label(k, "back")) + " resume · " + key(k === "phone" ? "Arrow buttons" : "D-pad") + " choose", kb: key("Enter") + " or " + key("Esc") + " resume · " + key("←") + " " + key("→") + " choose" }
    };
    $("cardKeys").innerHTML = html.card[style]; $("reportKeys").innerHTML = html.report[style]; $("bookKeys").innerHTML = html.book[style]; $("pauseKeys").innerHTML = html.pause[style];
    const tk = document.getElementById("taskKeys");
    if (tk) tk.innerHTML = Tasks.steerOnly() ? (style === "pad" ? key(k === "phone" ? "Tilt phone" : "Left stick") : key("←") + " " + key("→")) + " adjust · " + key(style === "pad" ? P.label(k, "skip") : "Esc") + " skip" : html.task[style];
    if (typeof phoneMission !== "undefined" && phoneMission && tk) tk.textContent = "Use the touch controls on your phone · Pause to take a break";
  }
  function input() {
    let s = kbSteer, g = keys.arrowup || keys.w ? 1 : 0, r = keys.arrowdown || keys.s ? 1 : 0;
    if (s || g || r) setCtrl("kb");
    if (pad) {
      if (pad.steer || pad.gas || pad.brake) setCtrl("pad");
      if (Math.abs(pad.steer) > Math.abs(s)) s = pad.steer; g = Math.max(g, pad.gas); r = Math.max(r, pad.brake);
    }
    if (phoneState) {
      if (phoneState.steer || phoneState.gas || phoneState.brake) setCtrl("phone");
      if (Math.abs(phoneState.steer) > Math.abs(s)) s = phoneState.steer; g = Math.max(g, phoneState.gas); r = Math.max(r, phoneState.brake);
    }
    return { s, g, r };
  }

  // ---- game controller: buttons, menu focus, connect / disconnect messages ----
  const overlayNow = () => graphicsBlocked ? $("graphicsRecovery") : !$("newGameConfirm").classList.contains("hidden") ? $("newGameConfirm") : howOpen ? $("howto") : mode === "pause" ? $("pause") : bookOpen ? $("book") : mode === "card" ? $("card") : mode === "lobby" ? $("lobby") : mode === "report" ? $("report") : mode === "task" ? $("task") : null;
  let padFocus = null;
  function moveFocus(dir) {
    const next = GameUI.nextFocus(overlayNow(), dir); if (!next) return;
    clearFocus(); padFocus = next; padFocus.classList.add("padfocus"); padFocus.focus({ preventScroll: true });
    padFocus.scrollIntoView({ block: "nearest" }); Sfx.click();
  }
  function clearFocus() { if (padFocus) padFocus.classList.remove("padfocus"); padFocus = null; }
  document.addEventListener("focusin", e => { if (padFocus && e.target !== padFocus) clearFocus(); });
  function pollPad() {
    pad = Pad.poll(); $("padChip").classList.toggle("hidden", !pad);
    if (!pad) return;
    if (padFocus && (!overlayNow() || !overlayNow().contains(padFocus) || padFocus.offsetParent === null)) clearFocus();
    for (const b of pad.pressed) {
      Sfx.init(); setCtrl("pad");
      if (b === "cross") GameUI.activateFocused(overlayNow(), () => action("next"));
      else if (b === "circle") { action("back"); clearFocus(); }
      else if (b === "triangle") action("read");
      else if (b === "square") action("book");
      else if (b === "options") action("pause");
      else if (b === "left" || b === "up") moveFocus(-1);
      else if (b === "right" || b === "down") moveFocus(1);
    }
  }
  // The phone follows the current game surface. Menus use explicit arrow
  // buttons; tilting the device never moves menu focus or selects an item.
  function phoneSelectedButton(overlay, screen) {
    const focused = document.activeElement;
    if (overlay && focused && overlay.contains(focused) && focused.tagName === "BUTTON" && GameUI.visible(focused)) return focused;
    const defaults = { lobby: GameUI.visible($("continueBtn")) ? "continueBtn" : "kbStart", story: "cardNext", book: "bookClose", pause: "pauseResume", report: "reportKeep", howto: "howClose", confirm: "newGameCancel" };
    const button = defaults[screen] ? $(defaults[screen]) : null;
    return GameUI.visible(button) ? button : null;
  }
  function phoneContext() {
    const overlay = overlayNow(), screens = { lobby: "lobby", card: "story", book: "book", pause: "pause", report: "report", howto: "howto", newGameConfirm: "confirm", graphicsRecovery: "recovery", task: "task" };
    const screen = graphicsBlocked ? "recovery" : overlay ? screens[overlay.id] || (mode === "task" ? "task" : "lobby") : mode === "play" ? "drive" : mode === "count" ? "count" : "lobby";
    const titles = { drive: "Explore with your rover", lobby: "Choose your mission", story: "Mission story", book: "Sticker book", pause: "Game paused", report: "Mission report", howto: "How to play", confirm: "Start a new game?", recovery: "Game needs attention", task: "Mission task", count: "Get ready!" };
    const defaults = { lobby: "Start exploring", story: "Continue", book: "Close book", pause: "Resume", report: "Keep exploring", howto: "Got it", confirm: "Keep my progress", recovery: "Select", task: "Mission on phone", count: "Starting soon", drive: "Explore" };
    const chosen = phoneSelectedButton(overlay, screen);
    const planet = chosen && chosen.dataset && chosen.dataset.world;
    const selection = chosen && ((chosen.getAttribute && chosen.getAttribute("aria-label")) || (planet === "moon" ? "Choose Moon" : planet === "mars" ? "Choose Mars" : chosen.innerText || chosen.textContent));
    if (screen === "story" && $("cardNext").disabled) defaults.story = "Please wait…";
    const title = screen === "story" ? $("cardName").textContent || titles[screen] : screen === "task" ? $("taskTitle").textContent || titles[screen] : titles[screen];
    return { screen, title: title.slice(0, 96), selection: (selection || defaults[screen]).replace(/\s+/g, " ").trim().slice(0, 96),
      canRead: screen === "story" && !$("cardRead").disabled, canBook: screen === "drive" || screen === "book",
      canBack: ["book", "pause", "howto", "confirm"].includes(screen) || screen === "story" && !$("cardNext").disabled };
  }
  function publishPhoneContext() {
    if (phoneLink && typeof phoneLink.setContext === "function") phoneLink.setContext(phoneContext());
  }
  function pollPhone(now) {
    phoneState = phoneLink ? phoneLink.sample() : null;
    if (!phoneState) { publishPhoneContext(); return; }
    const state = phoneState;
    const menu = !!overlayNow() && (mode !== "task" || graphicsBlocked);
    if (menu) { phoneState = { ...state, steer: 0, gas: 0, brake: 0 }; }
    for (const b of state.pressed) {
      // A paused remote task still exposes the computer's pause menu.
      if (phoneMission && mode === "task" && !graphicsBlocked && b !== "options") continue;
      Sfx.init(); setCtrl("phone");
      if (b === "left" || b === "up" || b === "right" || b === "down") {
        if (!!overlayNow() && (mode !== "task" || graphicsBlocked)) moveFocus(b === "left" || b === "up" ? -1 : 1);
      } else if (b === "cross") {
        const selected = phoneSelectedButton(overlayNow(), phoneContext().screen);
        if (selected) selected.click(); else action("next");
      } else if (b === "circle") { action("back"); clearFocus(); }
      else if (b === "triangle") action("read");
      else if (b === "square") action("book");
      else if (b === "options") action("pause");
    }
    publishPhoneContext();
  }
  addEventListener("gamepadconnected", () => {
    toast("Controller connected!", "Ready to drive", "🎮"); setCtrl("pad"); setTimeout(() => Pad.rumble("hello"), 120);
    $("padStatus").innerHTML = 'Connected! Press <i class="ps x">✕</i>'; if (Pad.lights.supported) $("lightsBtn").classList.remove("hidden");
  });
  addEventListener("gamepaddisconnected", () => {
    $("padStatus").innerHTML = 'Press <i class="ps x">✕</i>';
    if (ctrlNow === "pad") lostInput("🎮 The controller disconnected. Plug it back in, or keep going with the keyboard.");
    else toast("Controller disconnected", "", "🎮");
  });
  // An input dropped out mid-game: pause so nobody loses time, and let them carry on with another one.
  function lostInput(msg) { if (mode === "play" || mode === "task" || mode === "count") openPause(msg); else toast(msg, "Input disconnected", "⚠️"); }

  // ---- pause menu (P, Options) ----
  let pausePrev = "play";
  function openPause(msg) {
    if (mode === "count") { mode = "play"; $("count").innerHTML = ""; $("intro").classList.remove("show"); countN = -1; }
    if (mode !== "play" && mode !== "task") return;
    pausePrev = mode; mode = "pause"; rover.v = 0; clearHeldInput(); clearFocus();
    if (phoneMission) { phoneMission.paused = true; phoneLink.setMission(phoneMission); }
    $("pauseMsg").textContent = msg || ""; $("pauseMsg").classList.toggle("hidden", !msg);
    $("pauseWorld").classList.toggle("hidden", pausePrev !== "play"); $("pauseTitle").classList.toggle("hidden", pausePrev !== "play");
    Icons.label($("pauseWorld"), "rocket", worldKey === "moon" ? "Go to Mars" : "Go to the Moon"); paintSound();
    $("pause").classList.remove("hidden"); showClock();
  }
  function resume() { clearHeldInput(); $("pause").classList.add("hidden"); clearFocus(); mode = pausePrev;
    if (phoneMission) { phoneMission.paused = false; phoneLink.setMission(phoneMission); }
    showClock(); }
  function paintSound() {
    const icon = Sfx.muted ? "soundOff" : "sound";
    Icons.label($("pauseSound"), icon, Sfx.muted ? "Sound: Off" : "Sound: On");
    Icons.label($("muteBtn"), icon);
    ["muteBtn", "pauseSound"].forEach(id => $(id).setAttribute("aria-pressed", String(!Sfx.muted)));
    $("muteBtn").setAttribute("aria-label", Sfx.muted ? "Sound muted. Turn sound on" : "Sound on. Mute sound");
  }
  function toTitle() { saveProgress(); resume(); mode = "lobby"; Sfx.music(null); $("lobby").classList.remove("hidden"); hudEls.forEach(id => $(id).classList.add("hidden")); showClock(); }
  $("pauseResume").onclick = () => action("next"); $("pauseWorld").onclick = () => action("world"); $("pauseSound").onclick = () => { action("mute"); paintSound(); }; $("pauseTitle").onclick = toTitle;

  // ---- How to play (title screen) ----
  let howOpen = false;
  function openHow() { howOpen = true; clearFocus(); $("howto").classList.remove("hidden"); }
  function closeHow() { howOpen = false; clearFocus(); $("howto").classList.add("hidden"); }
  $("howBtn").onclick = openHow; $("howClose").onclick = closeHow;
  // optional extra: match the DualSense lightbar to the planet (Chrome / Edge, USB). The game is the same without it.
  const padLight = () => Pad.lights.color(...(worldKey === "moon" ? [90, 120, 255] : [255, 90, 10]));
  $("lightsBtn").onclick = async () => { const ok = await Pad.lights.connect(); if (ok) await padLight(); $("lightsBtn").textContent = ok ? "💡 Lights on" : "💡 Lights not available"; };

  function action(a) {
    if (graphicsBlocked) return;
    if (!$("newGameConfirm").classList.contains("hidden")) {
      if (a === "back" || a === "next") $("newGameConfirm").classList.add("hidden");
      return;
    }
    if (a === "mute") { Sfx.setMuted(!Sfx.muted); store.set("mute", Sfx.muted ? "1" : ""); paintSound(); return; }
    if (howOpen) { if (a === "next" || a === "back") closeHow(); return; }
    if (mode === "pause") {
      if (a === "next" || a === "back" || a === "pause") resume();
      else if (a === "world" && pausePrev === "play") { resume(); setWorld(worldKey === "moon" ? "mars" : "moon"); beginCount(); }
      return;
    }
    if (mode === "task") { // a quick tap of Enter or ✕ counts as a short grab
      if (a === "next") taskPulse = .3; else if (a === "back" || a === "skip") Tasks.skip(); else if (a === "pause") openPause();
      return;
    }
    if (a === "book") { if (mode === "play" || bookOpen) toggleBook(); return; }
    if (bookOpen) { if (a === "next" || a === "back") toggleBook(); return; }
    if (a === "pause") { if (mode === "play" || mode === "count") openPause(); return; }
    if (a === "back") { // close a card (after the reading pause), or pause the game while driving
      if (mode === "card") { if (!cardUnlockAt) closeCard(); }
      else if (mode === "play") openPause();
      return;
    }
    if (a === "next") {
      if (mode === "report") keepExploring();
      else if (mode === "lobby") startPlay();
      else if (mode === "card") { if (cardUnlockAt) return; closeCard(); } // still in the 5-second reading pause
    } else if (a === "world") {
      if (mode === "lobby") setWorld(worldKey === "moon" ? "mars" : "moon");
      else if (mode === "play") { setWorld(worldKey === "moon" ? "mars" : "moon"); beginCount(); }
    } else if (a === "read" && mode === "card") readAloud();
  }

  // ------------------------------------------------------------------
  // title screen, countdown
  // ------------------------------------------------------------------
  // A stationary paint portrait reuses the story renderer. The clone shares
  // existing rover assets; restore the story scene and camera without disposing them.
  function paintRoverPreview(name) {
    const thumb = Models.thumbSetup(), model = R.group.clone(true), previous = thumb.model;
    const position = thumb.cam.position.clone(), rotation = thumb.cam.quaternion.clone(), yaw = thumb.holder.rotation.y;
    model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.setScalar(1);
    if (previous) thumb.holder.remove(previous);
    thumb.holder.add(model); thumb.holder.rotation.y = 0;
    try {
      const bounds = new T.Box3().setFromObject(model), centre = bounds.getCenter(new T.Vector3()), size = bounds.getSize(new T.Vector3());
      model.position.sub(centre);
      const distance = (Math.max(size.x, size.y, size.z) * .5 + 4) / Math.tan(16 * Math.PI / 180) * .9;
      thumb.cam.position.set(0, distance * .32, distance); thumb.cam.lookAt(0, 0, 0); thumb.holder.rotation.y = -.7;
      thumb.renderer.render(thumb.scene, thumb.cam);
      $("paintPreview").src = thumb.renderer.domElement.toDataURL("image/png"); $("paintPreview").alt = name + " rover preview";
      $("paintName").textContent = name;
    } finally {
      thumb.holder.remove(model); if (previous) thumb.holder.add(previous);
      thumb.cam.position.copy(position); thumb.cam.quaternion.copy(rotation); thumb.holder.rotation.y = yaw;
    }
  }
  ROVER_COLORS.forEach(([name, hex]) => {
    const b = document.createElement("button"); b.className = "sw"; b.style.background = hex; b.title = name; b.setAttribute("aria-label", name + " rover"); b.setAttribute("aria-pressed", "false");
    b.onclick = () => { R.setColor(hex); store.set("color", hex); mark(); Sfx.init(); Sfx.click(); };
    $("swatches").appendChild(b);
    function mark() { [...$("swatches").children].forEach(c => { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", String(c === b)); }); paintRoverPreview(name); }
    if (store.get("color", ROVER_COLORS[1][1]) === hex) mark();
  });
  document.querySelectorAll(".pick").forEach(b => b.onclick = () => { Sfx.init(); Sfx.click(); if (worldKey !== b.dataset.world) setWorld(b.dataset.world); });
  document.querySelectorAll(".pick").forEach(b => { const w = WORLDS[b.dataset.world]; b.querySelector("small").innerHTML = "<b></b> · " + w.sites.length + " ghosts"; b.querySelector("b").textContent = w.level; });

  // ---- mission timer. It only runs while you are actually driving: never during cards, the sticker book, the countdown or a wake-up. ----
  const clock = { left: {}, free: {}, on: store.get("timer", "1") !== "0", sec: -1 };
  const resetClock = k => { clock.left[k] = WORLDS[k].timeLimit; clock.free[k] = false; };
  resetClock("moon"); resetClock("mars");
  const fmt = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  const timing = () => clock.on && !clock.free[worldKey] && !sites.every(s => found.has(s.id));
  function showClock() {
    const el = $("hudTime"), t = clock.left[worldKey];
    el.classList.toggle("hidden", !clock.on || mode === "lobby");
    el.classList.toggle("low", timing() && t <= 30);
    el.classList.toggle("free-explore", !!clock.free[worldKey]);
    $("timeTxt").textContent = clock.free[worldKey] ? "Free explore" : fmt(t);
  }
  function tickClock(dt) {
    if (!timing()) return;
    clock.left[worldKey] -= dt; const t = clock.left[worldKey], sec = Math.ceil(t);
    if (sec !== clock.sec) { clock.sec = sec; showClock(); if (sec <= 30 && sec > 0) Sfx.tick(); }
    if (t <= 0) openReport();
  }
  function addTime(n, includeComplete = false) { if (!clock.on || clock.free[worldKey] || (!includeComplete && !timing())) return; clock.left[worldKey] += n; showClock(); const b = $("timeBonus"); b.textContent = "+" + n + "s"; b.classList.remove("go"); void b.offsetWidth; b.classList.add("go"); }
  const timerBtn = $("timerBtn"), paintTimerBtn = () => { Icons.label(timerBtn, "clock", "Timer: " + (clock.on ? "On" : "Off")); timerBtn.classList.toggle("off", !clock.on); };
  timerBtn.onclick = () => { clock.on = !clock.on; store.set("timer", clock.on ? "1" : "0"); paintTimerBtn(); Sfx.init(); Sfx.click(); }; paintTimerBtn();
  // time's up: a friendly report, never "game over". You can always carry on.
  function openReport() {
    mode = "report"; rover.v = 0;
    $("repWorld").textContent = WD.label; $("repGhosts").textContent = sites.filter(s => found.has(s.id)).length + " / " + sites.length; $("repStars").textContent = stars.filter(s => starsGot.has(s.id)).length + " / " + stars.length; const bonus = sites.filter(s => tasksDone.has(s.id)).length; $("repBonus").textContent = bonus ? "+ " + bonus + " task bonus " + (bonus > 1 ? "stars" : "star") : "";
    $("report").classList.remove("hidden"); showClock();
  }
  function keepExploring() { clock.free[worldKey] = true; saveProgress(); $("report").classList.add("hidden"); mode = "play"; showClock(); }
  function tryAgain() { for (const s of sites) { found.delete(s.id); tasksDone.delete(s.id); } for (const s of stars) starsGot.delete(s.id); resetClock(worldKey); $("report").classList.add("hidden"); setWorld(worldKey); beginCount(); }
  $("reportKeep").onclick = keepExploring; $("reportRetry").onclick = tryAgain;
  const tips = new Set(); let bumpT = 0, sandBuzzT = 0;
  function tip(id, text) { if (tips.has(id)) return; tips.add(id); toast(text, "Mars tip", "💡"); }
  $("kbStart").onclick = () => action("next");
  $("bookBtn").onclick = () => action("book");
  $("bookClose").onclick = () => action("book");
  $("muteBtn").onclick = () => action("mute");
  if (store.get("mute", "")) Sfx.setMuted(true);
  paintSound();
  const hudEls = ["hud", "hudR", "compass", "coords", "mini"];
  function startPlay() {
    if (savedProgress) { continueGame(); return; }
    progressStarted = true;
    Sfx.init(); $("lobby").classList.add("hidden"); hudEls.forEach(id => $(id).classList.remove("hidden"));
    Sfx.music(worldKey); beginCount();
  }
  function beginCount() { mode = "count"; saveProgress(); countT = 0; countN = -1; rover.v = 0; $("intro").innerHTML = "<b></b><span></span>"; Icons.label($("intro").firstChild, worldKey, WD.label); $("intro").lastChild.textContent = WD.level; $("intro").classList.add("show"); showClock(); }
  function tickCount(dt) {
    countT += dt; const n = Math.floor(countT / .8);
    if (n !== countN) {
      countN = n;
      if (n < 3) { $("count").innerHTML = "<span>" + (3 - n) + "</span>"; Sfx.count(); }
      else if (n === 3) { $("count").innerHTML = "<span style='color:#3ddc6f'>GO!</span>"; Sfx.go(); mode = "play"; $("intro").classList.remove("show"); }
    }
  }
  function clearCount(dt) { if (countN >= 3) { countT += dt; if (countT > 3.3) { $("count").innerHTML = ""; countN = -1; } } }

  // ------------------------------------------------------------------
  // story cards, sticker book, read aloud
  // ------------------------------------------------------------------
  const stickerImg = {};
  function getStickerImg(site) {
    return stickerImg[site.id] || (stickerImg[site.id] = Models.sticker(site.type, site));
  }
  $("cardArt").appendChild(Models.thumbSetup().renderer.domElement);
  const discoveryFx = DiscoveryFX.create({ THREE: T, root: $("hostView"),
    bookButton: () => $("bookBtn"), starTarget: () => $("hudStars").closest(".science") || $("hudStars").parentElement, getSticker: getStickerImg,
    project(site) { const p = new T.Vector3(site.g.position.x, site.h0 + 26, site.y).project(camera); return { x: clamp((p.x + 1) * vw / 2, 70, vw - 70), y: clamp((1 - p.y) * vh / 2, 70, vh - 70) }; } });

  function openCard(site, kind) {
    card = site; cardKind = kind; mode = "card"; rover.v = 0;
    if (kind === "site") { pendingSite = site.id; pendingPhase = "story"; }
    stopReading();
    $("cardKicker").textContent = site.kicker; $("cardName").textContent = site.name; $("cardWhere").textContent = site.where;
    Icons.label($("cardWow"), "star", site.wow || ""); $("cardWow").classList.toggle("hidden", !site.wow);
    $("cardStory").textContent = site.story;
    $("cardFacts").innerHTML = "";
    [["f1", "search", "What I discovered", site.found], ["f2", "pin", "Where I am now", site.now], ["f3", "tool", "Engineering secret", site.eng]].forEach(([c, icon, title, txt]) => {
      if (!txt) return; const d = document.createElement("div"); d.className = "fact " + c; d.innerHTML = "<b></b><span></span>"; Icons.label(d.firstChild, icon, title); d.lastChild.textContent = txt; $("cardFacts").appendChild(d);
    });
    $("cardTag").textContent = site.lat !== undefined ? `Real landing site: ${Math.abs(site.lat).toFixed(2)}°${site.lat >= 0 ? "N" : "S"}, ${Math.abs(site.lon).toFixed(2)}°${site.lon >= 0 ? "E" : "W"}` : "";
    $("cardRibbon").classList.toggle("hidden", kind === "world" || kind === "review");
    $("cardReplay").classList.toggle("hidden", kind !== "review" || !Tasks.has(site.id));
    if (kind === "review") Icons.label($("cardReplay"), "tool", tasksDone.has(site.id) ? "Replay mission task" : "Try mission task");
    const other = worldKey === "moon" ? "mars" : "moon", otherDone = WORLDS[other].sites.every(s => found.has(s.id));
    Icons.label($("cardNext"), kind === "world" ? otherDone ? "spark" : "rocket" : kind === "end" ? "home" : kind === "deep" ? "spark" : kind === "review" ? "book" : "play", kind === "world" ? (otherDone ? "Deep space signals…" : other === "mars" ? "Launch to Mars" : "Fly to the Moon") : kind === "end" ? "Back to title" : kind === "deep" ? "Next signal" : kind === "review" ? "Back to sticker book" : "Keep exploring");
    startCardWait(site, kind);
    $("card").classList.toggle("deep", kind === "deep" || kind === "end");
    $("cardTag").classList.toggle("hidden", !$("cardTag").textContent);
    Models.thumbShow(site.type, site);
    $("card").classList.remove("hidden"); $("card").querySelector(".box").scrollTop = 0; refreshPrompts();
    saveProgress();
  }
  // ---- reading pause: the first time a ghost's or deep-space card opens, its main button waits 5 seconds ----
  let cardUnlockAt = 0; const cardSeen = new Set(), CARD_WAIT = 5;
  function startCardWait(site, kind) {
    const b = $("cardNext"), waits = Preferences.readingDelay && (kind === "site" || kind === "deep" || kind === "end") && !!site.id && !cardSeen.has(site.id);
    if (site.id && kind !== "world") cardSeen.add(site.id);
    cardUnlockAt = waits ? performance.now() + CARD_WAIT * 1000 : 0;
    b.classList.remove("pop"); b.classList.toggle("locked", waits); b.disabled = waits; b.style.setProperty("--p", 0);
    if (waits) { const lk = document.createElement("span"); lk.className = "lk"; lk.innerHTML = "<b>" + CARD_WAIT + "</b>"; b.prepend(lk); }
  }
  function tickCardWait() {
    if (!cardUnlockAt) return;
    const b = $("cardNext"), left = (cardUnlockAt - performance.now()) / 1000;
    if (mode !== "card") { cardUnlockAt = 0; return; }
    if (left > 0) { b.style.setProperty("--p", 1 - left / CARD_WAIT); const n = b.querySelector(".lk b"); if (n) n.textContent = Math.ceil(left); return; }
    cardUnlockAt = 0; b.disabled = false; const lk = b.querySelector(".lk"); if (lk) lk.remove();
    b.classList.remove("locked"); void b.offsetWidth; b.classList.add("pop"); Sfx.chime();
  }
  function closeCard() {
    stopReading();
    $("card").classList.add("hidden");
    const k = cardKind; card = null; mode = "play";
    if (k === "review") { returnToBook(); return; }
    if (k === "site") {
      pendingSite = null; pendingPhase = null; saveProgress();
      updateHud();
      if (sites.every(s => found.has(s.id))) {
        confetti(); Sfx.cheer();
        const scored = clock.on && !clock.free[worldKey]; // the time left is the score
        openCard(Object.assign({}, WORLD_DONE[worldKey], scored ? { wow: "Mission complete with " + fmt(clock.left[worldKey]) + " to spare! ⭐" } : {}), "world"); showClock();
      }
    } else if (k === "world") {
      const other = worldKey === "moon" ? "mars" : "moon";
      if (!WORLDS[other].sites.every(s => found.has(s.id))) { setWorld(other); beginCount(); }
      else { deepI = 0; confetti(); openDeep(); }
    } else if (k === "deep") {
      pendingDeep = null; deepI++; openDeep();
    } else if (k === "end") {
      pendingDeep = null; saveProgress(); mode = "lobby"; Sfx.music(null);
      $("lobby").classList.remove("hidden"); hudEls.forEach(id => $(id).classList.add("hidden")); showClock(); paintProgress();
    }
   
  }
  function openDeep() { const d = DEEP[deepI]; pendingDeep = d.id; deepSeen.add(d.id); Sfx.found(); openCard(d, deepI === DEEP.length - 1 ? "end" : "deep"); }
  let narration = null;
  function stopReading() {
    narration = null;
    if (window.speechSynthesis) speechSynthesis.cancel();
    Sfx.narration(false);
    Icons.label($("cardRead"), "sound", "Read aloud"); $("cardRead").setAttribute("aria-pressed", "false");
  }
  function readAloud() {
    if (!card || !window.speechSynthesis) return;
    if (narration) { stopReading(); return; }
    const txt = [card.name + ".", card.wow, card.story, card.found && "What I discovered. " + card.found, card.now && "Where I am now. " + card.now, card.eng && "Engineering secret. " + card.eng].filter(Boolean).join(" ");
    const u = new SpeechSynthesisUtterance(txt); u.rate = .95; u.lang = "en-US";
    narration = u; Sfx.narration(true);
    Icons.label($("cardRead"), "stop", "Stop reading"); $("cardRead").setAttribute("aria-pressed", "true");
    const finish = () => { if (narration === u) stopReading(); };
    u.onend = finish; u.onerror = finish;
    try { speechSynthesis.speak(u); } catch (_) { finish(); }
  }
  $("cardRead").disabled = !window.speechSynthesis;
  $("cardRead").setAttribute("aria-pressed", "false");
  Preferences.subscribe(key => {
    if (key === "readingDelay" && !Preferences.readingDelay && cardUnlockAt) { cardUnlockAt = performance.now(); tickCardWait(); }
  });
  $("cardNext").onclick = () => action("next");
  $("cardRead").onclick = () => action("read");

  function reviewSite(site, isTask = false) {
    bookReturn = { x: rover.x, y: rover.y, h: rover.h, world: worldKey, scrollTop: $("book").querySelector(".box").scrollTop };
    bookOpen = false; $("book").classList.add("hidden");
    const owner = Object.keys(WORLDS).find(k => WORLDS[k].sites.some(s => s.id === site.id));
    if (isTask) startTask(site, true, owner || worldKey); else openCard(site, "review");
  }
  function returnToBook() {
    const scrollTop = bookReturn ? bookReturn.scrollTop : 0;
    if (bookReturn) { Object.assign(rover, { x: bookReturn.x, y: bookReturn.y, h: bookReturn.h, v: 0, vy: 0, air: false }); rover.alt = rover.gPrev = H(rover.x, rover.y); camInit = false; }
    bookReturn = null; mode = "play";
    if (!bookOpen) toggleBook(scrollTop);
  }
  $("cardReplay").onclick = () => {
    if (!card || cardKind !== "review") return;
    const site = card, owner = Object.keys(WORLDS).find(k => WORLDS[k].sites.some(s => s.id === site.id));
    stopReading();
    $("card").classList.add("hidden"); card = null;
    startTask(site, true, owner || worldKey);
  };
  function toggleBook(scrollTop = 0) {
    bookOpen = !bookOpen; $("book").classList.toggle("hidden", !bookOpen); Sfx.click();
    if (bookOpen) {
      rover.v = 0;
      // The collected facts live here; an old driving toast must not cover stickers.
      $("toast").classList.remove("show"); toastT = 0;
      const body = $("bookBody"), nav = $("bookNav"); body.innerHTML = ""; nav.innerHTML = "";
      const addJump = (id, title, icon, earned, total) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "book-jump";
        button.setAttribute("aria-label", "Jump to " + title + ": " + earned + " of " + total + " collected");
        Icons.label(button, icon, title);
        const count = document.createElement("span"); count.className = "section-count"; count.textContent = earned + "/" + total; button.appendChild(count);
        button.onclick = () => {
          const target = $(id), pane = $("book").querySelector(".box"), header = $("bookHeader");
          if (!target) return;
          pane.scrollTop = Math.max(0, pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - header.offsetHeight - 12);
          nav.querySelectorAll("button").forEach(b => b.removeAttribute("aria-current")); button.setAttribute("aria-current", "location");
          target.focus({ preventScroll: true }); Sfx.click();
        };
        nav.appendChild(button);
      };
      const section = (title, list, have, task = false, planet = "deep") => {
        const icon = task ? "tool" : planet === "deep" ? "spark" : planet, earned = list.filter(have).length;
        const h = document.createElement("h3"); h.id = "book-section-" + (task ? "tasks" : planet); h.tabIndex = -1; Icons.label(h, icon, title);
        const count = document.createElement("span"); count.className = "section-count"; count.textContent = earned + " / " + list.length; h.appendChild(count); body.appendChild(h);
        addJump(h.id, task ? "Tasks" : planet === "moon" ? "Moon" : title, icon, earned, list.length);
        const grid = document.createElement("div"); grid.className = "stickers"; body.appendChild(grid);
        list.forEach((s, i) => {
          const ok = have(s), available = task ? found.has(s.id) : ok;
          const d = document.createElement(available ? "button" : "div"); d.className = "stk" + (ok ? "" : " no"); d.style.setProperty("--r", ok ? ((i % 3) - 1) * 2.5 + "deg" : "0deg");
          d.dataset.planet = task ? Object.keys(WORLDS).find(k => WORLDS[k].sites.some(site => site.id === s.id)) || "deep" : planet;
          if (available) { const im = document.createElement("img"); im.src = getStickerImg(s); im.alt = ""; im.loading = "lazy"; d.appendChild(im); }
          else { const placeholder = document.createElement("span"); placeholder.className = "sticker-placeholder"; placeholder.setAttribute("aria-hidden", "true"); placeholder.textContent = "?"; d.appendChild(placeholder); }
          const name = task ? Tasks.title(s.id) : (s.short || s.name);
          const caption = document.createElement("span"); caption.className = "patch-name"; caption.textContent = available ? name : "Signal waiting"; d.appendChild(caption);
          const badge = document.createElement("span"); badge.className = "patch-status" + (task && ok ? " complete" : available && task ? " ready" : "");
          Icons.label(badge, !available ? "lock" : task ? ok ? "check" : "tool" : "book", !available ? "Not found" : task ? ok ? "Complete" : "Try task" : "Read story"); d.appendChild(badge);
          if (task && ok) { const seal = document.createElement("span"); seal.className = "patch-seal"; seal.setAttribute("aria-hidden", "true"); seal.innerHTML = Icons.svg("check"); d.appendChild(seal); }
          if (available) { d.type = "button"; d.id = "sticker-" + (task ? "task-" : "story-") + s.id; d.setAttribute("aria-label", (task ? (ok ? "Replay task: " : "Try task: ") : "Read story: ") + name); d.onclick = () => reviewSite(s, task); }
          else d.setAttribute("aria-label", "Not found yet");
          grid.appendChild(d);
        });
      };
      section("The Moon", WORLDS.moon.sites, s => found.has(s.id), false, "moon");
      section("Mars", WORLDS.mars.sites, s => found.has(s.id), false, "mars");
      section("Deep space", DEEP, s => deepSeen.has(s.id));
      section("Mission tasks", [].concat(WORLDS.moon.sites, WORLDS.mars.sites).filter(s => Tasks.has(s.id)), s => tasksDone.has(s.id), true);
      const ul = $("bookFacts"); ul.innerHTML = "";
      for (const k in WORLDS) WORLDS[k].stars.forEach((s, i) => {
        const li = document.createElement("li"), ok = starsGot.has(k + i); li.className = ok ? "" : "no";
        Icons.label(li, "star", ok ? s[2] : "A star is still waiting on " + (k === "moon" ? "the Moon" : "Mars") + "…"); ul.appendChild(li);
      });
      const starTotal = Object.values(WORLDS).reduce((n, w) => n + w.stars.length, 0);
      addJump("book-section-stars", "Stars", "star", starsGot.size, starTotal);
      $("book").querySelector(".box").scrollTop = scrollTop;
    }
  }

  function continueGame() {
    if (!savedProgress) { startPlay(); return; }
    const data = savedProgress;
    for (const [set, ids] of [[found, data.found], [starsGot, data.stars], [tasksDone, data.tasks], [deepSeen, data.deep], [cardSeen, data.seen]]) { set.clear(); ids.forEach(id => set.add(id)); }
    for (const k of Object.keys(WORLDS)) { clock.left[k] = data.clocks[k].left; clock.free[k] = data.clocks[k].free; }
    pendingSite = data.pendingSite; pendingDeep = data.pendingDeep || null;
    pendingPhase = !pendingSite ? null : data.pendingPhase || (data.seen.includes(pendingSite) || tasksDone.has(pendingSite) ? "story" : "task");
    progressStarted = true;
    setWorld(data.world);
    Object.assign(rover, data.rover, { v: 0, vy: 0, air: false, boost: 0, gVy: 0 }); rover.alt = rover.gPrev = H(rover.x, rover.y); camInit = false;
    Sfx.init(); Sfx.music(worldKey); $("lobby").classList.add("hidden"); hudEls.forEach(id => $(id).classList.remove("hidden"));
    const pending = sites.find(s => s.id === pendingSite);
    if (pending) { if (pendingPhase === "story" || tasksDone.has(pending.id)) openCard(pending, "site"); else startTask(pending); }
    else if (sites.every(s => found.has(s.id))) {
      const other = worldKey === "moon" ? "mars" : "moon";
      if (WORLDS[other].sites.every(s => found.has(s.id))) {
        deepI = pendingDeep ? DEEP.findIndex(s => s.id === pendingDeep) : DEEP.findIndex(s => !deepSeen.has(s.id));
        if (deepI < 0) { mode = "play"; clock.free[worldKey] = true; toast("Open the sticker book to revisit your stories and mission tasks.", "Welcome back, explorer!", "📒"); }
        else openDeep();
      } else {
        const scored = clock.on && !clock.free[worldKey];
        openCard(Object.assign({}, WORLD_DONE[worldKey], scored ? { wow: "Mission complete with " + fmt(clock.left[worldKey]) + " to spare! ⭐" } : {}), "world");
      }
    } else if (clock.on && !clock.free[worldKey] && clock.left[worldKey] <= 0) openReport();
    else beginCount();
    showClock(); updateHud();
  }
  function newGame() {
    $("newGameConfirm").classList.add("hidden");
    progressStarted = false; savedProgress = null; progress.clear(); pendingSite = null; pendingPhase = null; pendingDeep = null; bookReturn = null;
    found.clear(); starsGot.clear(); deepSeen.clear(); tasksDone.clear(); cardSeen.clear(); resetClock("moon"); resetClock("mars");
    mode = "lobby"; setWorld(worldKey); paintProgress(); startPlay();
  }
  $("continueBtn").onclick = continueGame;
  $("newGameBtn").onclick = () => $("newGameConfirm").classList.remove("hidden");
  $("newGameCancel").onclick = () => $("newGameConfirm").classList.add("hidden");
  $("newGameConfirmBtn").onclick = newGame;
  paintProgress();
  setInterval(() => { if (progressStarted && mode !== "lobby") saveProgress(); }, 2000);
  addEventListener("pagehide", saveProgress);
  addEventListener("blur", saveProgress);

  let toastT = 0;
  const toastIcons = { "⭐": "star", "🛠": "tool", "🎮": "controller", "⚠️": "report", "💡": "spark", "📒": "book" };
  function toast(txt, title, ico) { $("toast").classList.toggle("top", mode !== "play" && mode !== "count"); $("toastTxt").textContent = txt; $("toastTitle").textContent = title || "Science star!"; Icons.label($("toastIco"), toastIcons[ico] || (Icons.names.includes(ico) ? ico : "star")); $("toast").classList.add("show"); toastT = title ? 4 : 8; }

  // confetti (drawn on a 2D canvas above the game)
  let conf = [];
  function confetti() {
    const cols = ["#ffd23f", "#59d8ff", "#ff7ac8", "#3ddc6f", "#ff9a2e", "#a970ff", "#fff"];
    for (let i = 0; i < 220; i++) conf.push({ x: vw * Math.random(), y: -20 - Math.random() * vh * .5, vx: rnd(-80, 80), vy: rnd(120, 380), r: rnd(0, 6), vr: rnd(-8, 8), w: rnd(8, 16), h: rnd(5, 10), c: cols[i % cols.length], t: rnd(4, 6.5) });
  }
  function drawConfetti(dt) {
    const g = $("fx").getContext("2d"); if (!conf.length && !drawConfetti.dirty) return;
    g.clearRect(0, 0, vw, vh); drawConfetti.dirty = conf.length > 0;
    conf = conf.filter(p => (p.t -= dt) > 0 && p.y < vh + 30);
    for (const p of conf) { p.x += p.vx * dt + Math.sin(p.t * 4 + p.w) * 40 * dt; p.y += p.vy * dt; p.r += p.vr * dt; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.r * 1.7)); g.fillStyle = p.c; g.globalAlpha = Math.min(1, p.t); g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); }
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  function updateHud() {
    $("hudFound").textContent = `${sites.filter(s => found.has(s.id)).length}/${sites.length}`;
    $("hudStars").textContent = `${stars.filter(s => starsGot.has(s.id)).length}/${stars.length}`;
  }
  function setSignal(n, label) {
    if (n !== sig) {
      document.querySelectorAll("#signal .bars i").forEach((b, i) => b.classList.toggle("on", i < n));
      $("signal").setAttribute("aria-label", "Signal strength: " + n + " of 4");
    }
    if (!!sigDist !== !!label) $("signal").classList.toggle("hidden", !label);
    sig = n; sigDist = label;
  }
  // ---- minimap: a round "radar" centred on the rover, north always up ----
  // The picture-book terrain for the whole world is painted once to an offscreen canvas.
  // Each frame we only slide that picture under the rover and redraw the markers.
  var mini = { S: 0, dpr: 1, R: 0, Rin: 0, k: 1, range: 1, terrain: null, over: null, ready: false, job: 0, key: "" };
  const RIM = 21;
  const BANDS = { // low -> middle -> high ground, kept soft and low-contrast so the markers stand out
    moon: { cols: [[134, 148, 186], [186, 193, 212], [233, 236, 244]], cuts: [.4, .63], crater: "rgba(70,80,120,.22)", ring: "rgba(255,255,255,.4)" },
    mars: { cols: [[176, 78, 48], [226, 130, 70], [240, 196, 142]], cuts: [.4, .63], crater: "rgba(120,40,20,.24)", ring: "rgba(255,225,190,.4)" }
  };
  function setupMini() {
    const c = $("mini"), S = Math.max(120, Math.round(Math.min(340, innerHeight * .44, innerWidth * .29))), dpr = Math.min(2, window.devicePixelRatio || 1), moon = worldKey === "moon";
    const range = moon ? 1800 : 1000; // how far the radar sees, in map units: about 450 km on the Moon, about 1,000 km on Mars
    Object.assign(mini, { S, dpr, R: S / 2, Rin: S / 2 - RIM, range, k: (S / 2 - RIM) / range });
    c.style.width = c.style.height = S + "px"; c.width = c.height = Math.round(S * dpr);
    c.style.setProperty("--glow", moon ? "#9db8ff" : "#ff9a3c");
    buildMiniOverlay();
    const key = worldKey; if (key !== mini.key) { mini.key = key; mini.ready = false; clearTimeout(mini.job); mini.job = setTimeout(buildMiniTerrain, 30); }
  }
  // Show a quick coarse map, then refine it at four times the resolution.
  // Both passes build in short batches; refined maps stay cached per planet.
  const miniCache = new Map(); let miniBuild = null;
  function buildMiniTerrain(refine = false) {
    const key = worldKey, range = worldKey === "moon" ? 1800 : 1000;
    const cached = miniCache.get(key);
    if (cached) {
      Object.assign(mini, cached, { ready: true });
      if (cached.rasterK >= 1 / 10) return;
      refine = true; // finish an earlier refinement interrupted by a planet switch
    }
    const rasterK = refine ? 1 / 10 : 1 / 40, mX = WD.wrap ? 0 : range, mY = range;
    const c = document.createElement("canvas");
    c.width = Math.ceil((W.w + 2 * mX) * rasterK); c.height = Math.ceil((W.h + 2 * mY) * rasterK);
    const g = c.getContext("2d"), im = g.createImageData(c.width, c.height), B = BANDS[key];
    const lut = [], lutOut = [], band = (cut, v) => smooth((v - cut + .006) / .012);
    for (let n = 0; n < 256; n++) {
      const v = n / 255, a = band(B.cuts[0], v), b = band(B.cuts[1], v);
      const col = [0, 1, 2].map(q => lerp(lerp(B.cols[0][q], B.cols[1][q], a), B.cols[2][q], b)), grey = (col[0] + col[1] + col[2]) / 3;
      lut.push(col); lutOut.push(col.map(q => lerp(q, grey, .45) * .8));
    }
    miniBuild = { key, c, g, im, B, rasterK, mX, mY, row: 0, lut, lutOut };
  }
  function stepMiniTerrain() {
    const job = miniBuild; if (!job) return;
    if (job.key !== worldKey) { miniBuild = null; return; }
    const { c, g, im, B, rasterK: k, mX, mY } = job, start = performance.now();
    let rows = 0;
    while (job.row < c.height && rows < 12 && (rows === 0 || performance.now() - start < 2)) {
      const y = job.row++, wz = (y + .5) / k - mY; rows++;
      for (let x = 0; x < c.width; x++) {
        const wx = (x + .5) / k - mX, v = vn(wx, wz, 1200, 11) * .8 + vn(wx, wz, 600, 15) * .2;
        const outside = wz < 0 || wz > W.h || (!WD.wrap && (wx < 0 || wx > W.w));
        const col = (outside ? job.lutOut : job.lut)[clamp(Math.round(v * 255), 0, 255)], i = (y * c.width + x) * 4;
        im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2]; im.data[i + 3] = 255;
      }
    }
    if (job.row < c.height) return;
    g.putImageData(im, 0, 0);
    const moon = worldKey === "moon", [cell, prob, rmin, rmax, keep] = moon ? [400, .62, 30, 140, 78] : [900, .25, 40, 110, 0];
    const blob = (x, z, r, fill, ring) => { for (const o of WD.wrap ? [-W.w, 0, W.w] : [0]) {
      const X = (x + o + mX) * k, Y = (z + mY) * k, rr = Math.max(.6, r * k);
      g.fillStyle = fill; g.beginPath(); g.arc(X, Y, rr, 0, 7); g.fill();
      if (ring) { g.strokeStyle = ring; g.lineWidth = Math.max(.4, k * 6); g.beginPath(); g.arc(X, Y, rr, .2, 2.6); g.stroke(); }
    } };
    if (!moon) for (let ix = 0; ix < W.w / 600; ix++) for (let iz = -2; iz <= Math.ceil((W.h + mY) / 600); iz++) { const sd = sandAt(ix, iz); if (sd) blob(sd.x, sd.z, sd.r, "rgba(110,44,26,.3)"); }
    for (let ix = Math.floor(-mX / cell) - 1; ix <= Math.ceil((W.w + mX) / cell); ix++) for (let iz = Math.floor(-mY / cell) - 1; iz <= Math.ceil((W.h + mY) / cell); iz++) {
      const cr = craterCell(ix, iz, cell, prob, rmin, rmax); if (cr && cr.r >= keep) blob((ix + cr.fx) * cell, (iz + cr.fz) * cell, cr.r, B.crater, B.ring);
    }
    const result = { terrain: c, mX, mY, rasterK: k };
    miniCache.set(job.key, result); Object.assign(mini, result, { ready: true }); miniBuild = null;
    if (job.rasterK < 1 / 10) buildMiniTerrain(true);
  }
  function buildMiniOverlay() { // very soft globe shading, glowing rim, curved planet name and the N for north
    const { S, dpr, R, Rin } = mini, moon = worldKey === "moon", c = document.createElement("canvas"); c.width = c.height = Math.round(S * dpr);
    const g = c.getContext("2d"); g.scale(dpr, dpr);
    const sh = g.createRadialGradient(R, R, Rin * .72, R, R, Rin); sh.addColorStop(0, "rgba(10,14,50,0)"); sh.addColorStop(.75, "rgba(10,14,50,.1)"); sh.addColorStop(1, "rgba(10,14,50,.38)");
    g.fillStyle = sh; g.beginPath(); g.arc(R, R, Rin, 0, 7); g.fill();
    const hi = g.createRadialGradient(R - Rin * .4, R - Rin * .45, 0, R - Rin * .4, R - Rin * .45, Rin * .8); hi.addColorStop(0, "rgba(255,255,255,.07)"); hi.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hi; g.beginPath(); g.arc(R, R, Rin, 0, 7); g.fill();
    const rim = g.createLinearGradient(0, 0, S, S); (moon ? ["#e3ebff", "#a9c0ff", "#7d94d6"] : ["#ffd898", "#ffa347", "#e8702a"]).forEach((col, i) => rim.addColorStop(i / 2, col));
    g.fillStyle = rim; g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.arc(R, R, Rin, 0, 7, true); g.fill();
    g.lineWidth = 2.5; g.strokeStyle = "#141a3c"; g.beginPath(); g.arc(R, R, Rin, 0, 7); g.stroke();
    g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.8)"; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
    const name = moon ? "MOON" : "MARS", rr = Rin + RIM / 2, stepA = 17 / rr, mid = -.58;
    g.font = "700 17px Fredoka, ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#141a3c";
    [...name].forEach((ch, i) => { const a = mid + (i - (name.length - 1) / 2) * stepA; g.save(); g.translate(R + Math.sin(a) * rr, R - Math.cos(a) * rr); g.rotate(a); g.fillText(ch, 0, 1); g.restore(); });
    g.fillStyle = "#141a3c"; g.beginPath(); g.arc(R, RIM / 2 + 3, 12.5, 0, 7); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#fff"; g.font = "700 15px Fredoka, ui-rounded, system-ui, sans-serif"; g.fillText("N", R, RIM / 2 + 4);
    mini.over = c;
  }
  function miniGhost(g, X, Y, s, p) { // a little cyan ghost with a white outline
    g.fillStyle = "rgba(89,216,255," + (.2 + .18 * p) + ")"; g.beginPath(); g.arc(X, Y, s * (1.45 + p * .35), 0, 7); g.fill();
    g.beginPath(); g.arc(X, Y - s * .12, s * .82, Math.PI, 0); g.lineTo(X + s * .82, Y + s * .85);
    for (let i = 1; i <= 3; i++) g.quadraticCurveTo(X + s * .82 - (i - .5) * s * .547, Y + s * .5, X + s * .82 - i * s * .547, Y + s * .85);
    g.closePath(); g.lineJoin = "round";
    g.strokeStyle = "#0c2c4a"; g.lineWidth = 5; g.stroke(); g.strokeStyle = "#fff"; g.lineWidth = 2.6; g.stroke(); g.fillStyle = "#3fcfff"; g.fill();
    g.fillStyle = "#0c2c4a"; g.beginPath(); g.arc(X - s * .3, Y - s * .12, s * .16, 0, 7); g.arc(X + s * .3, Y - s * .12, s * .16, 0, 7); g.fill();
  }
  function miniStar(g, X, Y, s) { // a gold star with a dark outline
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? s * .48 : s * 1.08; g.lineTo(X + Math.cos(a) * r, Y + Math.sin(a) * r); } g.closePath();
    g.lineJoin = "round"; g.strokeStyle = "#3a2600"; g.lineWidth = 4; g.stroke(); g.fillStyle = "#ffd23f"; g.fill();
  }
  function layoutMiniSignals(items, R, edge, gap, nearestId) {
    // Keep the nearest destination exact; bundle other distant signals that
    // share a bearing, then give each bundle enough room around the rim.
    const sorted = items.slice().sort((a, b) => (b.s.id === nearestId) - (a.s.id === nearestId) || a.p.d - b.p.d);
    const groups = [];
    for (const item of sorted) {
      const group = item.p.out && item.s.id !== nearestId && groups.find(other => other.p.out && other.s.id !== nearestId && Math.hypot(other.p.X - item.p.X, other.p.Y - item.p.Y) < gap);
      if (group) { group.count++; continue; }
      groups.push({ s: item.s, p: { ...item.p }, count: 1 });
    }
    const occupied = groups.filter(item => !item.p.out).map(item => item.p);
    for (const item of groups) if (item.p.out) {
      const p = item.p; p.anchorX = p.X; p.anchorY = p.Y;
      if (item.s.id !== nearestId) {
        const step = gap / Math.max(1, edge), choices = [0];
        for (let n = 1; n * step <= Math.PI; n++) choices.push(n * step, -n * step);
        let best = null, clearance = -1;
        for (const offset of choices) {
          const angle = p.a + offset, X = R + Math.cos(angle) * edge, Y = R + Math.sin(angle) * edge;
          const distance = occupied.length ? Math.min(...occupied.map(other => Math.hypot(X - other.X, Y - other.Y))) : gap;
          if (distance > clearance) { best = { X, Y }; clearance = distance; }
          if (distance >= gap) break;
        }
        if (best) { p.X = best.X; p.Y = best.Y; }
      }
      occupied.push(p);
    }
    return groups.reverse(); // the nearest signal is drawn last
  }
  function miniBoundarySegments(R, S, k, x, y, width, height, wrap) {
    const lines = [], top = R - y * k, bottom = R + (height - y) * k;
    if (top > 0 && top < S) lines.push([0, top, S, top, 0, 0, S, top]);
    if (bottom > 0 && bottom < S) lines.push([0, bottom, S, bottom, 0, bottom, S, S - bottom]);
    if (!wrap) {
      const left = R - x * k, right = R + (width - x) * k;
      if (left > 0 && left < S) lines.push([left, 0, left, S, 0, 0, left, S]);
      if (right > 0 && right < S) lines.push([right, 0, right, S, right, 0, S - right, S]);
    }
    return lines;
  }
  function drawMiniBoundary(g, S, R, k) {
    const lines = miniBoundarySegments(R, S, k, rover.x, rover.y, W.w, W.h, WD.wrap);
    for (const [x1, y1, x2, y2, x, y, w, h] of lines) {
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.strokeStyle = "rgba(235,240,255,.16)"; g.lineWidth = 1; g.beginPath();
      for (let n = -S; n < S * 2; n += 11) { g.moveTo(n, 0); g.lineTo(n + S, S); } g.stroke(); g.restore();
      g.setLineDash([4, 4]); g.lineWidth = 1.5; g.strokeStyle = "rgba(20,26,60,.8)";
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    }
  }
  function drawMini() {
    const c = $("mini"), g = c.getContext("2d"), { S, dpr, R, Rin, k } = mini, moon = worldKey === "moon";
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(R, R, Rin, 0, 7); g.clip();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    if (mini.ready) { // slide the pre-painted world so the rover sits in the middle; on Mars it repeats east-west
      const t = mini.terrain, lonX = WD.wrap ? ((rover.x % W.w) + W.w) % W.w : rover.x, ox = R - (lonX + mini.mX) * k, oy = R - (rover.y + mini.mY) * k;
      if (WD.wrap) { const tw = W.w * k; for (let n = -1; n <= 1; n++) if (ox + n * tw < S && ox + (n + 1) * tw > 0) g.drawImage(t, 0, 0, t.width, t.height, ox + n * tw, oy, tw + .6, t.height * k / mini.rasterK); }
      else g.drawImage(t, ox, oy, t.width * k / mini.rasterK, t.height * k / mini.rasterK);
    } else { g.fillStyle = moon ? "#bac1d4" : "#e28246"; g.fillRect(0, 0, S, S); }
    drawMiniBoundary(g, S, R, k);
    const GS = Math.min(9.5, Rin * .18), edge = Math.max(1, Rin - GS * 2.2 - 8); // marker size, and how far out a marker may sit so it is never cut off
    const place = s => { const dx = wdx(s.x - rover.x) * k, dy = (s.y - rover.y) * k, d = Math.hypot(dx, dy) || 1, f = Math.min(1, edge / d); return { X: R + dx * f, Y: R + dy * f, d, out: d > edge, a: Math.atan2(dy, dx) }; };
    // science stars: tiny soft sparkles, only when they are well inside the circle
    for (const s of stars) if (!starsGot.has(s.id)) { const p = place(s); if (p.d > Rin - 8) continue; g.fillStyle = "rgba(255,244,170,.95)"; g.strokeStyle = "rgba(120,80,0,.55)"; g.lineWidth = 1;
      g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 1.3 : 4; g.lineTo(p.X + Math.cos(a) * r, p.Y + Math.sin(a) * r); } g.closePath(); g.stroke(); g.fill(); }
    // dashed cyan line to the nearest ghost still waiting (or to its icon on the rim)
    const near = nearestUnfound();
    const signals = layoutMiniSignals(sites.filter(s => !found.has(s.id)).map(s => ({ s, p: place(s) })), R, edge, GS * 2.6, near && near.s.id);
    if (near) { const p = place(near.s); g.setLineDash([7, 5]); g.lineDashOffset = -time * 16; g.lineCap = "round";
      g.strokeStyle = "rgba(12,44,74,.7)"; g.lineWidth = 4.5; g.beginPath(); g.moveTo(R, R); g.lineTo(p.X, p.Y); g.stroke();
      g.strokeStyle = "#7fe6ff"; g.lineWidth = 2.4; g.stroke(); g.setLineDash([]); }
    // found ghosts are gold stars; they shrink away at the edge instead of being cut off
    for (const s of sites) if (found.has(s.id)) { const p = place(s), f = clamp((edge + 10 - p.d) / 10, 0, 1); if (f > 0) miniStar(g, p.X, p.Y, GS * f); }
    // unfound ghosts: inside the circle when in range, otherwise pinned to the rim in their real direction
    for (const { s, p, count } of signals) {
      const pulse = .5 + .5 * Math.sin(time * 3 + s.x * .01);
      if (p.out) { // leader lines preserve the true bearing when a bundle moves
        if (Math.hypot(p.X - p.anchorX, p.Y - p.anchorY) > 3) {
          g.strokeStyle = "rgba(12,44,74,.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(p.anchorX, p.anchorY); g.lineTo(p.X, p.Y); g.stroke();
        }
        const ax = Math.cos(p.a), ay = Math.sin(p.a), tx = p.X + ax * (GS * .8 + 7), ty = p.Y + ay * (GS * .8 + 7);
        g.beginPath(); g.moveTo(tx + ax * 5, ty + ay * 5); g.lineTo(tx - ay * 5 - ax * 2, ty + ax * 5 - ay * 2); g.lineTo(tx + ay * 5 - ax * 2, ty - ax * 5 - ay * 2); g.closePath();
        g.lineJoin = "round"; g.strokeStyle = "#0c2c4a"; g.lineWidth = 3; g.stroke(); g.fillStyle = "#7fe6ff"; g.fill();
        miniGhost(g, p.X, p.Y, GS * .8, pulse);
      } else miniGhost(g, p.X, p.Y, GS, pulse);
      if (count > 1) {
        g.fillStyle = "#141a3c"; g.beginPath(); g.arc(p.X + 7, p.Y - 8, 7, 0, 7); g.fill();
        g.font = "700 10px Fredoka, ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText(String(count), p.X + 7, p.Y - 7.5);
      }
    }
    // the rover: a chunky white arrow pointing the way it faces, with a soft pulse ring
    const pr = (time * .9) % 1;
    g.strokeStyle = "rgba(255,255,255," + (1 - pr) * .85 + ")"; g.lineWidth = 2.5; g.beginPath(); g.arc(R, R, 10 + pr * 16, 0, 7); g.stroke();
    g.save(); g.translate(R, R); g.rotate(rover.h); g.lineJoin = "round";
    g.beginPath(); g.moveTo(15, 0); g.lineTo(-10, -10.5); g.lineTo(-4.5, 0); g.lineTo(-10, 10.5); g.closePath();
    g.strokeStyle = "#141a3c"; g.lineWidth = 5; g.stroke(); g.fillStyle = "#fff"; g.fill(); g.restore();
    g.restore();
    if (mini.over) g.drawImage(mini.over, 0, 0, S, S);
  }

  // ------------------------------------------------------------------
  // game update
  // ------------------------------------------------------------------
  function update(dt) {
    time += dt;
    if (toastT > 0 && (toastT -= dt) <= 0) $("toast").classList.remove("show");
    if (bookOpen || mode === "pause") { Sfx.engine(0, false); return; }
    // A newly loaded world must have its terrain and collision lists before driving.
    if (!terrain.visible && (mode === "play" || mode === "count")) return;
    if (mode === "play") tickClock(dt);
    if (mode === "count") tickCount(dt); else clearCount(dt);
    if (mode === "revive") tickRevive(dt);
    const playing = mode === "play", inp = playing ? input() : { s: 0, g: 0, r: 0 };
    const moon = worldKey === "moon";

    // --- driving (on the flat map, same as before) ---
    rover.boost = Math.max(0, rover.boost - dt);
    const top = WD.maxV * (rover.boost > 0 ? 1.55 : 1) * (rover.sand ? .3 : 1);
    if (playing) {
      // pedals are analog: a light squeeze of a trigger drives slowly, a full press drives at full speed
      // Brake/reverse takes priority if both pedals are held, as it does on a controller.
      const target = inp.r > 0 ? -WD.maxV * .45 * inp.r : inp.g > 0 ? top * inp.g : 0;
      const acc = rover.sand && Math.abs(rover.v) > top ? 700 : inp.r > 0 && rover.v > 0 ? 360 + 340 * inp.r : target === 0 ? 420 : rover.boost > 0 ? 900 : 360;
      rover.v += clamp(target - rover.v, -acc * dt, acc * dt);
    } else rover.v *= Math.pow(.02, dt);
    rover.steer = lerp(rover.steer, inp.s, 1 - Math.exp(-10 * dt));
    const grip = Math.min(1, Math.abs(rover.v) / 90) * (rover.air ? .35 : 1);
    rover.h += rover.steer * 2.1 * dt * grip * (rover.v < 0 ? -1 : 1);
    rover.x += Math.cos(rover.h) * rover.v * dt; rover.y += Math.sin(rover.h) * rover.v * dt;
    if (!WD.wrap) rover.x = clamp(rover.x, 40, W.w - 40);
    rover.y = clamp(rover.y, 40, W.h - 40);
    // Mars obstacles: bump off mesas, boulders and crater rims; soft sand slows the rover right down
    rover.sand = false; bumpT -= dt;
    for (const o of solids) {
      const dx = rover.x - o.x, dz = rover.y - o.z, d = Math.hypot(dx, dz), min = o.r + 16; if (d >= min || d === 0) continue;
      const nx = dx / d, nz = dz / d, headOn = -(Math.cos(rover.h) * nx + Math.sin(rover.h) * nz) * Math.sign(rover.v || 1);
      rover.x = o.x + nx * min; rover.y = o.z + nz * min;
      if (Math.abs(rover.v) > 70 && headOn > .2) {
        rover.v = o.kind !== "mesa" && headOn > .6 ? -rover.v * .35 : rover.v * .75; // a small bounce straight back, or a glancing slide. No damage.
        if (bumpT <= 0) { bumpT = .35; shake = Math.max(shake, .4); Sfx.bump(.35); Pad.rumble("bump"); bodyVel += 12; }
        if (o.kind === "crater") tip("crater", "This crater's rim is too steep to climb. Find the gentle way around!");
      }
    }
    for (const sd of sands) if (Math.hypot(rover.x - sd.x, rover.y - sd.z) < sd.r) { rover.sand = true; tip("sand", "Careful! Spirit the rover got stuck in soft sand like this in 2009."); }
    sandBuzzT -= dt; if (rover.sand && Math.abs(rover.v) > 20 && sandBuzzT <= 0) { sandBuzzT = .7; Pad.rumble("sand"); } // long low rumble in soft sand

    const c = Math.cos(rover.h), s = Math.sin(rover.h), sp = Math.abs(rover.v);
    // --- up and down: follow the ground, and float after bumps (low gravity!) ---
    const ground = H(rover.x, rover.y), gVy = (ground - rover.gPrev) / dt; rover.gPrev = ground;
    if (!rover.air) {
      if (gVy < rover.gVy - WD.gravity * dt * 1.5 && rover.gVy > 22 && Math.abs(rover.v) > 100) { rover.air = true; rover.vy = rover.gVy; }
      else { rover.alt = ground; rover.vy = gVy; }
    }
    if (rover.air) {
      rover.vy -= WD.gravity * dt; rover.alt += rover.vy * dt;
      if (rover.alt <= ground) {
        const hit = Math.max(0, gVy - rover.vy); rover.alt = ground; rover.air = false; bodyVel -= hit * .35;
        if (hit > 30) { shake = Math.max(shake, Math.min(1, hit / 130)); Sfx.bump(hit / 150); for (let i = 0; i < 24; i++) puff(rnd(-14, 14), rnd(-12, 12), 1.6); }
      }
    }
    rover.gVy = gVy;
    const hf = H(rover.x + c * 15, rover.y + s * 15), hb = H(rover.x - c * 15, rover.y - s * 15);
    const hr = H(rover.x - s * 12, rover.y + c * 12), hl = H(rover.x + s * 12, rover.y - c * 12);
    const k = 1 - Math.exp(-(rover.air ? 2 : 12) * dt);
    rover.pitch = lerp(rover.pitch, rover.air ? clamp(rover.vy / 300, -.3, .3) : Math.atan2(hf - hb, 30), k);
    rover.roll = lerp(rover.roll, rover.air ? 0 : Math.atan2(hl - hr, 24), k);

    // --- the rover model: bounce, wheels, eyes ---
    bodyVel += (-150 * bodyOff - 9 * bodyVel) * dt; bodyOff = clamp(bodyOff + bodyVel * dt, -5, 5);
    R.group.position.set(rover.x, rover.alt, rover.y);
    R.group.rotation.set(rover.roll + rover.steer * Math.min(1, Math.abs(rover.v) / 200) * -.08, -rover.h, rover.pitch);
    R.body.position.y = bodyOff + Math.sin(time * 30) * Math.min(.5, Math.abs(rover.v) / 500);
    wheelSpin -= rover.v * dt / 6.6;
    for (const w of R.wheels) {
      const wx = rover.x + c * w.userData.x - s * w.userData.z, wz = rover.y + s * w.userData.x + c * w.userData.z;
      const want = rover.air ? -2.5 : clamp(H(wx, wz) - (rover.alt + w.userData.x * Math.sin(rover.pitch) - w.userData.z * Math.sin(rover.roll)), -4, 4.5);
      w.position.y = lerp(w.position.y, 6.6 + want, 1 - Math.exp(-18 * dt)); w.rotation.z = wheelSpin;
    }
    R.pupils.forEach((p, i) => p.position.z = (i ? -3.3 : 3.3) + rover.steer * 1);
    R.head.rotation.y = -rover.steer * .35;
    blink -= dt; if (blink < 0) blink = rnd(2, 5); R.eyes.forEach(e => e.scale.y = blink < .12 ? .15 : 1); R.pupils.forEach(e => e.visible = blink >= .12);
    R.ant.rotation.z = lerp(R.ant.rotation.z, rover.v / WD.maxV * .45 + bodyVel * .01, 1 - Math.exp(-8 * dt));
    R.flame.visible = rover.boost > 0; if (R.flame.visible) R.flame.scale.set(rnd(.8, 1.2), rnd(.8, 1.4), rnd(.8, 1.2));

    // --- dust and tracks ---
    if (!rover.air && sp > 40) layTrack();
    const trailN = emissionCount("trail", !rover.air && sp > 40 ? 60 * (1 + Math.min(1, sp / 140)) : 0, dt);
    for (let i = 0; i < trailN; i++) puff(-13, Math.random() < .5 ? 12.5 : -12.5, 1);
    const boostN = emissionCount("boost", rover.boost > 0 ? 180 : 0, dt);
    for (let i = 0; i < boostN; i++) spark.emit(rover.x - c * 26 + rnd(-3, 3), rover.alt + 15 + rnd(-3, 3), rover.y - s * 26 + rnd(-3, 3), -c * rnd(40, 120), rnd(-10, 20), -s * rnd(40, 120), rnd(.25, .5), rnd(6, 11), 1, rnd(.5, .8), .15, .9, 0, 2, -10);
    function puff(lx, lz, power) {
      const x = rover.x + c * lx - s * lz, z = rover.y + s * lx + c * lz, y = rover.alt + 1.5, dir = Math.sign(rover.v) || 1;
      if (moon) dust.emit(x, y, z, -c * dir * sp * rnd(.1, .3) * power + rnd(-14, 14), rnd(22, 55) * power, -s * dir * sp * rnd(.1, .3) * power + rnd(-14, 14), 3, rnd(2.5, 5), .78, .78, .82, .85, WD.gravity, 0, 0, y - 3);
      else dust.emit(x, y, z, -c * dir * rnd(8, 28) + rnd(-10, 10) + 14, rnd(6, 20) * power, -s * dir * rnd(8, 28) + rnd(-10, 10), rnd(1.4, 2.6), rnd(6, 10), .9, .62, .42, .4, -3, 1.2, 13);
    }

    // --- ghosts: glow, sparkle, and wake up when the rover arrives ---
    for (const st of sites) {
      st.g.position.x = rx(st.x);
      if (st.alive) continue;
      const d = Math.hypot(wdx(st.x - rover.x), st.y - rover.y), rv = revive && revive.s === st;
      if (!rv) { st.model.position.y = 5 + Math.sin(time * 1.6 + st.x) * 3; st.model.rotation.y += dt * .35; }
      const pulse = (time * .7 + st.x * .01) % 1; st.ring.scale.setScalar(40 + pulse * 70); st.ring.material.opacity = .8 * (1 - pulse);
      st.beam.material.opacity = (.55 + .2 * Math.sin(time * 3 + st.x)) * (moon ? 1 : .75); st.core.material.opacity = moon ? .8 : .55; st.q.position.y = 80 + Math.sin(time * 2.4) * 5;
      for (let i = 0, n = emissionCount("ghost-" + st.id, d < 1100 ? 30 : 0, dt); i < n; i++) { const a = rnd(0, 6.3), r = rnd(4, 38); spark.emit(st.g.position.x + Math.cos(a) * r, st.h0 + rnd(0, 20), st.y + Math.sin(a) * r, 0, rnd(18, 55), 0, rnd(.8, 1.8), rnd(2.5, 5), .6, .92, 1, 1, 0, 0, -1.5); }
      if (playing && d < 100 && !rover.air) startRevive(st);
    }
    Models.holoFace.opacity = (moon ? .3 : .5) + (.1 * Math.sin(time * 9) + (Math.random() < 1 - Math.pow(.96, dt * 60) ? .2 : 0));

    // --- science stars ---
    for (const st of stars) {
      if (starsGot.has(st.id)) {
        if (st.pickupT === undefined) continue;
        st.pickupT += dt;
        const t = clamp(st.pickupT / .48, 0, 1), squash = Math.sin(Math.PI * clamp(t * 2, 0, 1));
        const fade = 1 - smooth(clamp((t - .35) / .65, 0, 1));
        st.mesh.scale.set((1 + .45 * squash) * fade, (1 - .3 * squash) * fade, fade);
        st.g.position.y = st.h0 + 20 + smooth(t) * 24;
        st.mesh.rotation.z = Math.sin(t * Math.PI) * .28;
        if (t >= 1) { st.g.visible = false; delete st.pickupT; }
        continue;
      }
      st.g.position.set(rx(st.x), st.h0 + 20 + Math.sin(time * 2.5 + st.x) * 3, st.y); st.mesh.rotation.y = time * 2.2;
      if (playing && Math.hypot(wdx(st.x - rover.x), st.y - rover.y) < 36) {
        starsGot.add(st.id); st.pickupT = 0;
        rover.boost = 2.4; toast(st.fact); Sfx.star(); Sfx.boost(); Pad.rumble("star"); addTime(10); updateHud(); saveProgress();
        if (typeof discoveryFx !== "undefined") discoveryFx.reward("star");
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, v = 38; spark.emit(st.g.position.x, st.g.position.y, st.y, Math.cos(a) * v, 18, Math.sin(a) * v, .35, 3, 1, .9, .4, 1, 25, 1, -1); }
      }
    }
    for (const l of labels) l.sp.position.x = rx(l.x);

    // --- dust devils (Mars) ---
    if (!moon) for (const d of devils) {
      const u = d.userData;
      if (u.far || Math.hypot(u.x - rover.x, u.z - rover.y) > 1500) { const a = rover.h + rnd(-1.1, 1.1), r = rnd(500, 1100); u.x = rover.x + Math.cos(a) * r; u.z = rover.y + Math.sin(a) * r; u.far = false; u.vx = rnd(25, 60); u.vz = rnd(-30, 30); }
      u.x += u.vx * dt; u.z += u.vz * dt; d.position.set(u.x, H(u.x, u.z), u.z);
      if (playing && Math.hypot(rover.x - u.x, rover.y - u.z) < 38) { // driving through one gives the rover a gentle sideways shove
        const px = -Math.sin(rover.h), pz = Math.cos(rover.h), side = (rover.x - u.x) * px + (rover.y - u.z) * pz >= 0 ? 1 : -1;
        rover.x += px * side * 90 * dt; rover.y += pz * side * 90 * dt; rover.h += side * .5 * dt; shake = Math.max(shake, .18);
        tip("devil", "Dust devils on Mars are real, and their wind sometimes cleaned dust off rovers' solar panels!");
      }
      d.children.forEach((ch, i) => { ch.rotation.y = time * (3 + i * .4) + u.seed; ch.position.x = Math.sin(time * 1.7 + i * .7 + u.seed) * (2 + i * 2.2); ch.position.z = Math.cos(time * 1.3 + i * .9 + u.seed) * (2 + i * 2.2); });
      for (let i = 0, n = emissionCount("devil-" + u.seed, 30, dt); i < n; i++) { const a = rnd(0, 6.3); dust.emit(u.x + Math.cos(a) * 8, d.position.y + 2, u.z + Math.sin(a) * 8, Math.cos(a + 1.6) * 30, rnd(15, 40), Math.sin(a + 1.6) * 30, 1.6, 8, .9, .64, .44, .3, -4, .8, 10); }
    }

    // --- signal: bars, distance, beeps that speed up as you get close ---
    if (playing) {
      const n = nearestUnfound();
      if (n) {
        const bars = n.d < 500 ? 4 : n.d < 1000 ? 3 : n.d < 1800 ? 2 : n.d < 3200 ? 1 : 0;
        const km = Math.round(n.d / WD.ppd * WD.kmPerDeg);
        setSignal(bars, km.toLocaleString() + " km");
        const targetName = n.s.short || n.s.name;
        if ($("compassTarget").textContent !== targetName) $("compassTarget").textContent = targetName;
        if ($("compassLbl").textContent !== sigDist) $("compassLbl").textContent = sigDist;
        $("needle").style.transform = "rotate(" + (Math.atan2(n.s.y - rover.y, wdx(n.s.x - rover.x)) - camH) + "rad)";
        if (bars >= 2 && lastPing !== n.s.id + bars) { lastPing = n.s.id + bars; if (bars === 2) Pad.rumble("signal"); }
        beepT -= dt; if (bars > 0 && beepT <= 0) { beepT = clamp(n.d / 1100, .16, 2.4); Sfx.beep(bars / 4); }
      } else { setSignal(0, ""); $("compassTarget").textContent = "All ghosts found!"; $("compassLbl").textContent = "Open your sticker book"; }
      Sfx.engine(sp / WD.maxV, true);
      const lat = WD.latMax - rover.y / WD.ppd, lon = WD.lonMin + (((rover.x % W.w) + W.w) % W.w) / WD.ppd;
      $("coordTxt").textContent = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
    } else Sfx.engine(0, false);
   
  }

  // A quiet material transformation, one expanding ring and an earned collection patch.
  // The original 1.5-second reveal and 3-second task transition stay unchanged.
  function startRevive(st) {
    mode = "revive"; rover.v = 0; revive = { s: st, t: 0, popped: false, a0: Math.atan2(rover.y - st.y, wdx(rover.x - st.x)) }; found.add(st.id); pendingSite = st.id; pendingPhase = "task"; saveProgress();
    discoveryFx.begin(st); Sfx.wake();
  }
  function tickRevive(dt) {
    const r = revive, st = r.s; r.t += dt;
    discoveryFx.step(r.t);
    if (!r.popped && r.t >= 1.5) {
      r.popped = true; setSiteAlive(st, true); st.model.position.y = 0; st.model.scale.setScalar(1.3);
      Sfx.found(); Pad.rumble("found"); updateHud(); discoveryFx.collect(st);
    }
    if (r.t > 3) { discoveryFx.cancel(); st.model.scale.setScalar(1.3); revive = null; startTask(st); }
  }

  // ------------------------------------------------------------------
  // camera
  // ------------------------------------------------------------------
  const camPos = new T.Vector3(), camLook = new T.Vector3(), want = new T.Vector3(), look = new T.Vector3(); let camInit = false;
  function keepCameraOutsideSolids(position) {
    const ax = rover.x, ay = rover.alt + 20, az = rover.y;
    const dx = position.x - ax, dy = position.y - ay, dz = position.z - az, a = dx * dx + dz * dz;
    if (a < 1) return;
    let stop = 1;
    for (const o of solids) {
      if (o.kind !== "mesa" && o.kind !== "boulder") continue;
      const radius = o.kind === "mesa" ? o.R + 6 : o.r * 1.05 + 6;
      const ox = ax - o.x, oz = az - o.z, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - radius * radius;
      const disc = b * b - 4 * a * c; if (disc < 0) continue;
      const enter = (-b - Math.sqrt(disc)) / (2 * a), exit = (-b + Math.sqrt(disc)) / (2 * a);
      if (exit <= 0 || enter >= stop) continue;
      const t = Math.max(0, enter), top = H(o.x, o.z) + (o.kind === "mesa" ? o.hgt : o.r * 1.5) + 6;
      if (ay + dy * t > top) continue;
      stop = Math.min(stop, Math.max(.05, t - .04));
    }
    if (stop < 1) { position.x = ax + dx * stop; position.y = ay + dy * stop; position.z = az + dz * stop; }
  }
  function updateCamera(dt) {
    if (camInit && (mode === "pause" || bookOpen)) return;
    const y0 = rover.alt; let kPos = 7, fov = 62;
    const focus = revive ? revive.s : mode === "task" && taskSite && taskSite.g ? taskSite : (mode === "card" && cardKind === "site" && card && card.g ? card : null);
    for (const st of sites) st.tag.visible = st.alive && st !== focus;
    if (focus) { // circle the ghost
      const a = (revive ? revive.a0 : 0) + time * .45, fx = focus.g.position.x;
      want.set(fx + Math.cos(a) * 135, focus.h0 + 52, focus.y + Math.sin(a) * 135); look.set(fx, focus.h0 + 20, focus.y); kPos = 2.2; fov = 50;
    } else if (mode === "lobby") { // slow orbit around the rover on the title screen
      const a = time * .22 + 1; want.set(rover.x + Math.cos(a) * 92, y0 + 34, rover.y + Math.sin(a) * 92); look.set(rover.x, y0 + 22, rover.y); kPos = 3; fov = 50;
      camH = rover.h;
    } else if (mode === "count") { // swing round from the front during 3, 2, 1
      const a = rover.h + Math.PI * (1 - smooth(countT / 2.3)) + Math.PI, r = 95;
      want.set(rover.x + Math.cos(a) * r, y0 + 40, rover.y + Math.sin(a) * r); look.set(rover.x, y0 + 16, rover.y); kPos = 6;
    } else { // chase camera
      camH = angLerp(camH, rover.h, 1 - Math.exp(-4.5 * dt));
      const cx = Math.cos(camH), cz = Math.sin(camH), sp = Math.abs(rover.v) / WD.maxV;
      want.set(rover.x - cx * (86 + sp * 10), y0 + 40, rover.y - cz * (86 + sp * 10));
      look.set(rover.x + Math.cos(rover.h) * 55, y0 + 14, rover.y + Math.sin(rover.h) * 55);
      fov = 62 + sp * 6 + (rover.boost > 0 ? 10 : 0); kPos = 9;
    }
    if (!focus && mode !== "lobby") keepCameraOutsideSolids(want);
    if (!camInit || camPos.distanceTo(want) > 4000) { camPos.copy(want); camLook.copy(look); camInit = true; }
    camPos.lerp(want, 1 - Math.exp(-kPos * dt)); camLook.lerp(look, 1 - Math.exp(-(kPos + 3) * dt));
    if (!focus && mode !== "lobby") keepCameraOutsideSolids(camPos);
    camPos.y = Math.max(camPos.y, H(camPos.x, camPos.z) + 10);
    shake = Math.max(0, shake - dt * 2.2);
    camera.position.copy(camPos); if (shake > 0) { camera.position.x += rnd(-1, 1) * shake * 5; camera.position.y += rnd(-1, 1) * shake * 5; }
    camera.lookAt(camLook);
    if (Math.abs(camera.fov - fov) > .05) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-5 * dt)); camera.updateProjectionMatrix(); }

    // things that travel with the camera
    const p = camera.position;
    sky.position.copy(p); starPts.position.copy(p); ridges.forEach(r => r.position.set(p.x, 0, p.z));
    sunSp.position.copy(sunDir).multiplyScalar(14000).add(p);
    if (worldKey === "moon") {
      // Earth sits in the real compass direction for where you are on the Moon.
      // (It's drawn lower in the sky than it really is, so you can see it while driving.)
      const la = (WD.latMax - rover.y / WD.ppd) * Math.PI / 180, lo = (WD.lonMin + rover.x / WD.ppd) * Math.PI / 180;
      let ex = -Math.sin(lo), ez = Math.sin(la) * Math.cos(lo); const hl = Math.hypot(ex, ez), up = Math.cos(la) * Math.cos(lo);
      if (hl > .02) { ex /= hl; ez /= hl; const el = (9 + Math.asin(clamp(up, 0, 1)) * 180 / Math.PI * .1) * Math.PI / 180; want.set(ex * Math.cos(el), Math.sin(el), ez * Math.cos(el)); earthDir.lerp(want, 1 - Math.exp(-2 * dt)).normalize(); }
      earth.position.copy(earthDir).multiplyScalar(13000).add(p); earthGlow.position.copy(earth.position);
    }
    sun.target.position.set(rover.x, rover.alt, rover.y); sun.position.copy(sunDir).multiplyScalar(500).add(sun.target.position);
    fill.target.position.copy(sun.target.position);
    fill.position.set(rover.x - sunDir.x * 400, rover.alt + 180, rover.y - sunDir.z * 400);
    dust.mat.uniforms.uScale.value = spark.mat.uniforms.uScale.value = vh * quality / (2 * Math.tan(camera.fov * Math.PI / 360));
  }

  function setupGraphicsRecovery() {
    const overlay = document.createElement("div"); overlay.id = "graphicsRecovery"; overlay.className = "overlay hidden"; overlay.style.zIndex = 50;
    overlay.innerHTML = '<div class="box" style="max-width:620px;text-align:center"><h2>Graphics paused</h2><p id="graphicsMessage" role="status"></p><div class="actions"><button class="btn go" id="graphicsResume" disabled>Waiting for graphics…</button><button class="btn alt" id="graphicsReload">Reload game</button></div></div>';
    $("hostView").appendChild(overlay);
    function changed(canvas, lost, event) {
      if (lost) {
        if (event) event.preventDefault(); lostContexts.add(canvas); graphicsBlocked = true;
        clearHeldInput(); stopReading(); Sfx.engine(0, false); saveProgress();
        if (typeof phoneMission !== "undefined" && phoneMission) { phoneMission.paused = true; phoneLink.setMission(phoneMission); }
        overlay.classList.remove("hidden");
      } else lostContexts.delete(canvas);
      $("graphicsResume").disabled = lostContexts.size > 0;
      $("graphicsResume").textContent = lostContexts.size ? "Waiting for graphics…" : "Return to game ▶";
      $("graphicsMessage").textContent = lostContexts.size ? "The browser interrupted 3D graphics. The game and timer are stopped. Waiting for recovery; you can also reload to continue from your saved progress." : "Graphics are ready again. Return when you're ready; the timer is still stopped.";
    }
    const canvas = renderer.domElement;
    canvas.addEventListener("webglcontextlost", e => changed(canvas, true, e));
    canvas.addEventListener("webglcontextrestored", e => changed(canvas, false, e));
    Models.onContextChange(changed);
    $("graphicsResume").onclick = () => {
      if (lostContexts.size) return;
      clearHeldInput(); clearFocus(); graphicsBlocked = false; overlay.classList.add("hidden");
      if (typeof phoneMission !== "undefined" && phoneMission) { phoneMission.paused = mode !== "task"; phoneLink.setMission(phoneMission); }
    };
    $("graphicsReload").onclick = () => { saveProgress(); location.reload(); };
  }

  // ------------------------------------------------------------------
  // main loop
  // ------------------------------------------------------------------
  $("pauseBtn").onclick = () => action("pause");
  setupGraphicsRecovery();
  GameUI.setup($("hostView"), overlayNow);
  let driveHintShown = !!store.get("driveHint", "");
  const hintObserver = new MutationObserver(() => {
    if (mode !== "play" || driveHintShown) return;
    driveHintShown = true; store.set("driveHint", "1");
    toast(ctrlNow === "phone" ? "Tilt your phone to steer. Hold Drive to go forward or Reverse to back up." : ctrlNow === "pad" ? "R2 drives, L2 reverses, and the left stick steers. Follow the glowing beams!" : "Hold ↑ or W to drive; ← → or A D steer. Follow the glowing beams!", "Ready, explorer?", "💡");
    hintObserver.disconnect();
  });
  hintObserver.observe($("count"), { childList: true });
  setWorld("moon"); refreshPrompts();
  if (document.fonts && document.fonts.load) document.fonts.load("700 64px Fredoka").then(() => { if (mode === "lobby") buildWorld(); buildMiniOverlay(); }).catch(() => { });
  window.ghostDebug = { // handy for testing in the browser console
    rover, found, starsGot, deepSeen, tasksDone, cardSeen, ctrl: () => ctrlNow, kbSteer: () => kbSteer, openPause, cardLocked: () => !!cardUnlockAt, Tasks, setWorld, input, pad: () => pad, clock, reachable, solids: () => solids, sands: () => sands, world: () => worldKey, openReport, devils: () => devils, toXY: (a, b) => toXY(a, b), mode: () => mode, sites: () => sites, stars: () => stars,
    warp(lat, lon) { [rover.x, rover.y] = toXY(lat, lon); rover.alt = rover.gPrev = H(rover.x, rover.y); rover.air = false; camInit = false; }, renderer
  };
  let last = performance.now(), slow = 0, frames = 0;
  function frame(now) {
    const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now;
    discoveryFx.guard(mode, graphicsBlocked);
    if (graphicsBlocked) { pollPad(); pollPhone(now); requestAnimationFrame(frame); return; }
    updateKb(Math.min(.05, raw)); pollPad(); pollPhone(now); tickCardWait();
    if (Tasks.active() && mode === "task") stepTask(Math.min(.05, raw));
    update(dt);
    if (Math.abs(rover.x - tcx) > 120 || Math.abs(rover.y - tcz) > 120) updateTerrain(Math.round(rover.x / 120) * 120, Math.round(rover.y / 120) * 120);
    stepTerrain(); stepMiniTerrain();
    dust.update(dt); spark.update(dt); updateTracks(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    if (mode === "card") Models.thumbRender(time * .8);
    if (mode !== "lobby") drawMini();
    drawConfetti(dt);
    // if the laptop is struggling, quietly lower the detail
    if (++frames > 90) { slow = raw > .03 ? slow + 1 : Math.max(0, slow - 1); if (slow > 70) { slow = 0; if (quality > 1) { quality = Math.max(1, quality - .25); resize(); } else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sun.castShadow = false; } else if (quality > .7) { quality = .7; resize(); } } }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
