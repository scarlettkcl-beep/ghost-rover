/* Runs the shared mission simulation and drawing locally on the phone. */
const PhoneMissions = (() => {
  function create({ onFinish = () => {}, onActive = () => {}, onReconnect = () => {} } = {}) {
    let mission = null, connected = false, controls = null, completed = false;
    let menuOpen = false, localPaused = false, destroyed = false, lastFrame = null, frameId = null, wasBlocked = true;
    let task = null, blocker = null, message = null, resume = null, reconnect = null, pause = null;
    const landscape = () => innerWidth > innerHeight;
    if (!document.getElementById('phoneMissionStyles')) {
      const style = document.createElement('link'); style.id = 'phoneMissionStyles'; style.rel = 'stylesheet'; style.href = 'phone-missions.css'; document.head.appendChild(style);
    }
    function release() {
      controls?.release();
      Object.assign(Tasks.inp, { hold: false, press: false, mouseHold: false, x: 0 });
    }
    function reason() {
      if (menuOpen) return 'Use the menu buttons on your phone to continue.';
      if (!connected) return 'Connection paused. Keep the game open on your computer.';
      if (document.hidden) return 'Mission paused while this page is hidden.';
      if (!landscape()) return 'Turn your phone sideways to continue this mission.';
      if (mission?.paused) return 'Game paused on your computer. Resume there to continue.';
      if (localPaused) return 'Take your time. Your mission is paused.';
      return '';
    }
    function paintBlocked() {
      if (!task || !mission) return;
      const why = reason(), blocked = !!why || completed;
      blocker.hidden = !blocked;
      message.textContent = completed ? 'Mission sent! Returning to the game…' : why;
      reconnect.hidden = connected;
      resume.hidden = !localPaused || !connected || mission.paused || !landscape();
      pause.disabled = completed;
      controls?.setDisabled?.(blocked);
      document.getElementById('phoneMissionControls').inert = blocked;
      document.getElementById('taskCv').style.pointerEvents = blocked ? 'none' : '';
      document.getElementById('taskSkip').disabled = blocked;
      if (blocked && !wasBlocked) release();
      wasBlocked = blocked;
      return blocked;
    }
    function clear() {
      release(); controls?.destroy(); controls = null;
      Tasks.cancel(); mission = null; completed = false; localPaused = false; lastFrame = null;
      if (task) { task.classList.remove('phone-mission'); blocker?.remove(); pause?.remove(); document.getElementById('phoneMissionControls')?.remove(); }
      blocker = message = resume = reconnect = pause = null;
      document.body.classList.remove('phone-mission-active'); onActive(false);
    }
    function receive(next) {
      if (destroyed) return;
      if (!next) { if (mission) clear(); return; }
      if (typeof next.runId !== 'string' || !next.runId || !Tasks.has(next.id)) return;
      if (mission?.runId === next.runId) {
        if (mission.id !== next.id) return;
        mission = { ...next }; paintBlocked(); return;
      }
      if (mission) clear();
      mission = { ...next }; completed = false; localPaused = false; wasBlocked = true;
      const runId = mission.runId;
      document.body.classList.add('phone-mission-active'); onActive(true);
      const started = Tasks.start(mission.id, { world: mission.world, pointerInput: false,
        onEnd(ok) {
          if (!mission || mission.runId !== runId || completed) return;
          completed = true; release(); task.classList.remove('hidden'); paintBlocked();
          onFinish({ runId, ok: !!ok });
        }
      });
      if (!started) { clear(); return; }
      task = document.getElementById('task'); task.classList.add('phone-mission');
      const box = task.querySelector('.taskbox');
      const deck = document.createElement('section'); deck.id = 'phoneMissionControls'; deck.setAttribute('aria-label', 'Mission touch controls'); box.appendChild(deck);
      controls = PhoneTaskControls.create({ Tasks, canvas: document.getElementById('taskCv'), root: deck, taskId: mission.id });
      document.getElementById('taskKeys').textContent = 'Play this mission here on your phone';
      const hint = controls.profile?.hint;
      if (hint) document.getElementById('taskHint').textContent = hint;
      document.getElementById('taskCv').setAttribute('aria-label', Tasks.title(mission.id) + '. ' + (hint || 'Use the touch controls to play.'));
      pause = document.createElement('button'); pause.id = 'phoneMissionPause'; pause.textContent = 'Pause'; pause.type = 'button';
      pause.onclick = () => { localPaused = true; release(); paintBlocked(); }; task.querySelector('.taskhead').appendChild(pause);
      blocker = document.createElement('div'); blocker.id = 'phoneMissionBlocker'; blocker.setAttribute('role', 'status');
      message = document.createElement('p'); resume = document.createElement('button'); resume.textContent = 'Resume mission'; resume.type = 'button';
      resume.onclick = () => { localPaused = false; lastFrame = null; release(); paintBlocked(); };
      reconnect = document.createElement('button'); reconnect.textContent = 'Reconnect phone'; reconnect.type = 'button'; reconnect.onclick = () => { release(); onReconnect(); };
      blocker.append(message, resume, reconnect); box.appendChild(blocker);
      Tasks.step(0, {}, false); lastFrame = null; paintBlocked();
    }
    function frame(now) {
      if (destroyed) return;
      const dt = lastFrame === null ? 0 : Math.min(.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
      if (mission && !paintBlocked() && Tasks.active()) Tasks.step(dt, controls.sample());
      frameId = requestAnimationFrame(frame);
    }
    function interrupt() { if (!mission) return; release(); lastFrame = null; if (!document.hidden && landscape()) localPaused = true; paintBlocked(); }
    function visibility() { if (!mission) return; release(); lastFrame = null; if (document.hidden) localPaused = true; paintBlocked(); }
    function resize() { if (!mission) return; release(); lastFrame = null; paintBlocked(); }
    addEventListener('blur', interrupt); addEventListener('pagehide', interrupt); addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    frameId = requestAnimationFrame(frame);
    return { receive, active: () => !!mission,
      setMenuOpen(value) { const next = !!value; if (next === menuOpen) return; menuOpen = next; release(); lastFrame = null; paintBlocked(); },
      setConnected(value) { connected = !!value; if (!connected) release(); lastFrame = null; paintBlocked(); },
      destroy() { if (destroyed) return; clear(); destroyed = true; cancelAnimationFrame(frameId);
        removeEventListener('blur', interrupt); removeEventListener('pagehide', interrupt); removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility);
      }
    };
  }
  return { create };
})();
if (typeof module !== 'undefined') module.exports = PhoneMissions;
