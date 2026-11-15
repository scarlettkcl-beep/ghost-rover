/* Sensor math stays independent of the page and connection. Degrees in, -1..1 out. */
const TiltSteering = (() => {
  const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
  // DeviceOrientation uses intrinsic Z-X-Y rotations (W3C orientation model).
  // Keep the complete pose: Euler beta/gamma are not screen-local steering axes.
  function orientationOf(event) {
    const { alpha, beta, gamma } = event;
    if (![alpha, beta, gamma].every(Number.isFinite)) return null;
    const half = Math.PI / 360;
    const cx = Math.cos(beta * half), sx = Math.sin(beta * half);
    const cy = Math.cos(gamma * half), sy = Math.sin(gamma * half);
    const cz = Math.cos(alpha * half), sz = Math.sin(alpha * half);
    return [cx * cy * cz - sx * sy * sz, sx * cy * cz - cx * sy * sz,
      cx * sy * cz + sx * cy * sz, cx * cy * sz + sx * sy * cz];
  }
  function twistOf(center, pose) {
    // conjugate(center) * pose, then keep only twist around the screen normal.
    const w = center[0] * pose[0] + center[1] * pose[1] + center[2] * pose[2] + center[3] * pose[3];
    const z = center[0] * pose[3] - center[1] * pose[2] + center[2] * pose[1] - center[3] * pose[0];
    return Math.hypot(w, z) < 1e-6 ? null : wrap(2 * Math.atan2(z, w) * 180 / Math.PI);
  }
  async function requestAccess(env) {
    if (!env.isSecureContext) return { ok: false, message: 'Tilt needs HTTPS. Open the laptop’s trusted HTTPS game address on this phone.' };
    const sensor = env.DeviceOrientationEvent;
    if (!sensor) return { ok: false, message: 'This browser has no tilt sensor support. Try Safari on iPhone or Chrome on Android.' };
    try {
      // Called synchronously from the Enable button, before any connection await.
      const result = typeof sensor.requestPermission === 'function' ? await sensor.requestPermission() : 'granted';
      return result === 'granted' ? { ok: true } : { ok: false, message: 'Motion permission was denied. Allow motion for this site, then tap Enable tilt again.' };
    } catch (_) { return { ok: false, message: 'Motion permission could not open. Tap Enable tilt again and allow motion for this site.' }; }
  }
  function create(options = {}) {
    const now = options.now || (() => performance.now()), staleMs = options.staleMs || 1000;
    const deadZone = options.deadZone ?? 2, fullScale = options.fullScale || 25;
    let enabled = false, center = null, reading = null, lastEvent = null, lastSample = null, angle = null, steer = 0;
    function reset() { center = reading = lastEvent = lastSample = null; steer = 0; }
    function feed(event, screenAngle = 0, at = now()) {
      if (!enabled) return;
      const value = orientationOf(event);
      if (value === null || !Number.isFinite(at) || !Number.isFinite(screenAngle)) { reset(); return; }
      if (angle !== wrap(screenAngle) || lastEvent !== null && at - lastEvent > staleMs) reset();
      angle = wrap(screenAngle); reading = value; lastEvent = at;
      if (center === null) center = reading;
    }
    function sample(at = now()) {
      if (!enabled || lastEvent === null || !Number.isFinite(at) || at - lastEvent > staleMs || at < lastEvent) {
        steer = 0; lastSample = null;
        return { ready: false, steer: 0, reason: enabled ? lastEvent === null ? 'waiting' : 'stale' : 'disabled' };
      }
      const delta = twistOf(center, reading);
      if (delta === null) { steer = 0; lastSample = null; return { ready: false, steer: 0, reason: 'invalid' }; }
      const magnitude = Math.abs(delta);
      // A counterclockwise turn of the screen steers left (negative).
      const target = magnitude <= deadZone ? 0 : -Math.sign(delta) * Math.min(1, (magnitude - deadZone) / (fullScale - deadZone));
      const dt = lastSample === null ? 1 / 60 : Math.min(.1, Math.max(0, (at - lastSample) / 1000)); lastSample = at;
      steer += (target - steer) * (1 - Math.exp(-12 * dt));
      if (Math.abs(steer) < .001) steer = 0;
      return { ready: true, steer, reason: 'ready' };
    }
    return { feed, sample, reset,
      enable(value = true) { enabled = !!value; reset(); },
      calibrate() { if (reading === null) return false; center = reading; steer = 0; lastSample = null; return true; }
    };
  }
  return { create, requestAccess, orientationOf, twistOf, wrap };
})();
if (typeof module !== 'undefined') module.exports = TiltSteering;
