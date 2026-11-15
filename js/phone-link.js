/* Local phone relay. Static hosting leaves this opt-in experiment hidden. */
const PhoneLink = (() => {
  const names = ['cross', 'circle', 'triangle', 'square', 'options', 'left', 'right', 'up', 'down'];
  const clamp = (v, a, b) => Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : 0;
  function clean(data = {}) {
    return { steer: clamp(data.steer, -1, 1), gas: clamp(data.gas, 0, 1), brake: clamp(data.brake, 0, 1),
      buttons: Object.fromEntries(names.map(name => [name, !!data.buttons && data.buttons[name] === true])) };
  }
  function quiet() { return clean(); }
  async function request(path, { body, headers = {} } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) { const error = new Error(result.error || 'The phone connection is unavailable.'); error.status = response.status; throw error; }
      return result;
    } finally { clearTimeout(timer); }
  }
  function createHost({ onDisconnect = () => {} } = {}) {
    let session = null, latest = null, received = 0, connected = false, needsNeutral = false, generation = 0, timer = null, info = null;
    let mission = null, missionRevision = 0, missionSent = 0, context = null;
    const edges = [], panels = [];
    function paint(message) { for (const p of panels) p.status.textContent = message; }
    function dropped(message) {
      latest = null; edges.length = 0;
      if (connected) { connected = false; needsNeutral = true; onDisconnect(message || 'Phone disconnected. Release the controls, reconnect, then resume.'); }
    }
    async function poll(token) {
      if (!session || token !== generation) return;
      const started = performance.now();
      try {
        if (missionRevision !== missionSent) {
          const revision = missionRevision;
          await request('/api/phone/mission', { body: { ...session, mission, revision } });
          if (token !== generation) return;
          missionSent = revision;
        }
        const data = await request('/api/phone/state', { body: { ...session, context }, headers: { 'X-Rover-Host': session.hostToken } });
        if (token !== generation) return;
        if (data.connected) {
          const next = clean({ ...data, buttons: data.down });
          latest = { steer: next.steer, gas: next.gas, brake: next.brake, down: next.buttons, taskReady: !!data.taskReady, missionResult: data.missionResult || null }; received = performance.now();
          for (const name of data.pressed || []) if (names.includes(name) && edges.length < 32) edges.push(name);
          connected = true; paint('Phone connected · controls follow the game screen.');
        } else { dropped(); paint('Waiting for your phone. Enter the pairing code on its screen.'); }
      } catch (error) {
        if (token === generation) {
          dropped();
          if (error.status === 403) {
            session = null;
            for (const p of panels) { p.code.textContent = 'Expired'; p.links.replaceChildren(); p.qr.replaceChildren(); p.qr.hidden = true; p.button.textContent = 'Create new phone code'; }
            paint('Pairing expired. Create a new code and join again on your phone.');
          } else paint('Connection interrupted. Check the local server and Wi-Fi.');
        }
      }
      if (token === generation && session) timer = setTimeout(() => poll(token), Math.max(0, 33 - (performance.now() - started)));
    }
    function close() {
      const old = session; session = null; generation++; clearTimeout(timer); dropped('Phone disconnected. Keep going with the keyboard or controller.');
      if (old) request('/api/phone/close', { body: old }).catch(() => {});
      for (const p of panels) { p.panel.hidden = true; p.button.textContent = 'Try phone steering'; }
    }
    async function open() {
      if (!session) {
        const token = ++generation;
        try {
          const created = await request('/api/phone/create', { body: {} });
          if (token !== generation) return;
          session = created; missionSent = 0; needsNeutral = true; poll(token);
        } catch (error) { paint(error.message); for (const p of panels) p.panel.hidden = false; return; }
      }
      for (const p of panels) {
        p.panel.hidden = false; p.button.textContent = 'Phone pairing'; p.code.textContent = session.room; p.links.replaceChildren(); p.qr.replaceChildren(); p.qr.hidden = true;
        let scanAddress = null;
        for (const address of info.urls || []) {
          try {
            const url = new URL(address); if (!['http:', 'https:'].includes(url.protocol)) continue;
            url.hash = session.room;
            if (!scanAddress || url.protocol === 'https:') scanAddress = url.href;
            const line = document.createElement('div'), link = document.createElement('a');
            link.href = url.href; link.textContent = (info.urls || []).length === 1 ? 'Open phone controller ↗' : 'Open controller · ' + url.hostname; link.title = url.href; link.target = '_blank'; link.rel = 'noopener';
            line.appendChild(link); p.links.appendChild(line);
          } catch (_) {}
        }
        if (scanAddress && typeof qrcode === 'function') {
          const qr = qrcode(0, 'M'); qr.addData(scanAddress); qr.make();
          p.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16 }).replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
          p.qr.hidden = false;
        }
      }
    }
    async function mount() {
      if (!/^https?:$/.test(location.protocol)) return;
      try { info = await request('/api/phone/info'); } catch (_) { return; }
      if (info.version !== 1) return;
      for (const id of ['lobbySettings', 'pauseSettings']) {
        const root = document.getElementById(id); if (!root) continue;
        const button = document.createElement('button'); button.className = 'btn alt'; button.type = 'button'; button.textContent = 'Try phone steering';
        const panel = document.createElement('div'); panel.className = 'phone-pairing'; panel.hidden = true;
        const text = document.createElement('p'); text.textContent = (info.urls || []).some(address => address.startsWith('https://')) ? 'Scan the QR code with your phone camera, or open the link below. Connect to use the menu buttons. Enable tilt steering when you are ready to drive.' : 'Local preview · real-phone tilt needs a trusted HTTPS test address. Pairing alone can be tested here.';
        const code = document.createElement('strong'), links = document.createElement('div'), status = document.createElement('p'), end = document.createElement('button'), qr = document.createElement('div');
        qr.className = 'phone-qr'; qr.hidden = true; qr.setAttribute('role', 'img'); qr.setAttribute('aria-label', 'Scan to open the phone controller with this pairing code');
        code.className = 'phone-pair-code'; code.setAttribute('aria-label', 'Phone pairing code');
        status.setAttribute('role', 'status'); end.type = 'button'; end.className = 'btn alt'; end.textContent = 'Disconnect phone'; end.onclick = close;
        panel.append(text, code, links, status, end, qr); root.append(button, panel); panels.push({ button, panel, code, links, status, qr });
        button.onclick = async () => { button.disabled = true; try { await open(); } finally { button.disabled = false; } };
      }
    }
    mount();
    addEventListener('pagehide', () => {
      const old = session; session = null; generation++; clearTimeout(timer);
      if (old && navigator.sendBeacon) navigator.sendBeacon('/api/phone/close', new Blob([JSON.stringify(old)], { type: 'application/json' }));
    });
    return {
      sample() {
        if (!latest || performance.now() - received > 700) { if (connected) dropped(); return null; }
        const pressed = edges.splice(0);
        if (needsNeutral) {
          if (Math.abs(latest.steer) < .08 && !latest.gas && !latest.brake) needsNeutral = false;
          else return { steer: 0, gas: 0, brake: 0, down: Object.fromEntries(names.map(n => [n, false])), pressed, taskReady: latest.taskReady, missionResult: latest.missionResult };
        }
        return { ...latest, down: { ...latest.down }, pressed };
      },
      setContext(value) { context = value; },
      setMission(value) { const next = value ? { id: value.id, runId: value.runId, world: value.world, paused: !!value.paused } : null; if (JSON.stringify(next) !== JSON.stringify(mission)) { mission = next; missionRevision++; } },
      clearMission() { mission = null; missionRevision++; if (latest) latest.missionResult = null; },
      ackMission() { mission = null; missionRevision++; if (latest) latest.missionResult = null; },
      clear() { needsNeutral = true; edges.length = 0; }, close
    };
  }
  function createController({ onStatus = () => {}, onMission = null, onContext = () => {} } = {}) {
    let session = null, latest = quiet(), sendingToken = null, timer = null, generation = 0;
    let missionResult = null, missionKey = null, contextKey = null, sequence = 0, urgent = false;
    const queue = [];
    async function send(token) {
      if (!session || token !== generation || sendingToken === token) return;
      sendingToken = token; urgent = false;
      const started = performance.now();
      const event = queue.length ? queue.shift() : null;
      const packet = { ...latest, buttons: event ? event.buttons : latest.buttons };
      try {
        const data = await request('/api/phone/input', { body: { ...session, ...packet, sequence: ++sequence, taskReady: typeof onMission === 'function', missionResult } });
        if (token !== generation) return;
        const nextContext = data.context || null, nextContextKey = JSON.stringify(nextContext);
        if (nextContextKey !== contextKey) { contextKey = nextContextKey; onContext(nextContext); }
        if (missionResult && data.missionAck === missionResult.runId) missionResult = null;
        const assignment = data.mission || null, key = JSON.stringify(assignment);
        if (key !== missionKey) { missionKey = key; if (onMission) onMission(assignment); }
      } catch (error) {
        if (token === generation) { session = null; latest = quiet(); queue.length = 0; onStatus('Disconnected. Check Wi-Fi, then tap Connect again.', 'error'); }
      } finally {
        if (sendingToken === token) sendingToken = null;
        if (session && token === generation) timer = setTimeout(() => send(token), queue.length || urgent ? 0 : Math.max(0, 33 - (performance.now() - started)));
      }
    }
    function wake() {
      urgent = true;
      if (session && sendingToken !== generation) { clearTimeout(timer); timer = setTimeout(() => send(generation), 0); }
    }
    function setInput(input) {
      const next = clean(input), changed = names.some(name => next.buttons[name] !== latest.buttons[name]);
      const pedalChanged = next.gas !== latest.gas || next.brake !== latest.brake;
      latest = next;
      if (changed) { if (queue.length >= 12) queue.length = 0; queue.push(next); }
      if (changed || pedalChanged) wake();
    }
    function release() {
      latest = quiet(); queue.length = 0; queue.push(latest);
      if (session && navigator.sendBeacon) navigator.sendBeacon('/api/phone/input', new Blob([JSON.stringify({ ...session, ...latest, sequence: ++sequence, taskReady: typeof onMission === 'function' })], { type: 'application/json' }));
      wake();
    }
    addEventListener('pagehide', release); addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    return {
      async join(room) {
        if (!/^\d{6}$/.test(room)) throw new Error('Enter the six-digit pairing code from the game.');
        if (session && session.room === room) return;
        const token = ++generation; clearTimeout(timer); session = null; latest = quiet(); missionKey = null; contextKey = null; sequence = 0; queue.length = 0;
        onStatus('Connecting…', 'waiting');
        try {
          const joined = await request('/api/phone/join', { body: { room } });
          if (token !== generation) return;
          session = { room, controllerToken: joined.controllerToken }; onStatus('Connected to the game', 'connected'); send(token);
        } catch (error) { if (token === generation) onStatus(error.message, 'error'); throw error; }
      },
      finishMission(result) {
        if (result && typeof result.runId === 'string' && typeof result.ok === 'boolean') { missionResult = { runId: result.runId, ok: result.ok }; wake(); }
      },
      setInput, release, connected: () => !!session
    };
  }
  return { createHost, createController, clean };
})();
if (typeof module !== 'undefined') module.exports = PhoneLink;
