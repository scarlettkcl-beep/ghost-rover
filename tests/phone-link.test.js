const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/phone-link.js'), 'utf8');
function setup(handler) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), events = {}, requests = [], beacons = [], scans = [];
  const element = () => ({ children: [], hidden: false, append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute() {} });
  const roots = { lobbySettings: element(), pauseSettings: element() };
  const ctx = vm.createContext({ module: { exports: {} }, URL, AbortController, Blob, qrcode(type, level) { const qr = require('../lib/qrcode.js')(type, level), add = qr.addData; qr.addData = value => { scans.push(value); add(value); }; return qr; },
    performance: { now: () => now }, location: { protocol: 'http:' },
    document: { hidden: false, createElement: element, getElementById: id => roots[id], addEventListener: (name, fn) => { events[name] = fn; } },
    addEventListener: (name, fn) => { events[name] = fn; }, navigator: { sendBeacon: (path, body) => { beacons.push({ path, body }); return true; } },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    async fetch(path, options) { const request = { path, ...options, data: options.body ? JSON.parse(options.body) : null }; requests.push(request); const result = await handler(request); return { ok: result.ok !== false, status: result.status || 200, json: async () => result.data || result }; }
  });
  vm.runInContext(source, ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { api: ctx.module.exports, roots, requests, events, beacons, scans, flush, jump(ms) { now += ms; }, async advance(ms) { now += ms; const due = [...timers].filter(([, t]) => t.at <= now); for (const [id, t] of due) { timers.delete(id); t.fn(); } await flush(); } };
}
(async () => {
  let state = { connected: true, steer: 0, gas: 0, brake: 0, down: {}, pressed: [] }, lost = 0;
  const host = setup(req => {
    if (req.path.endsWith('/info')) return { version: 1, urls: ['http://192.168.1.2:8766/phone.html', 'javascript:alert(1)'] };
    if (req.path.endsWith('/create')) return { room: '123456', hostToken: 'secret' };
    if (req.path.startsWith('/api/phone/state')) return state;
    return { ok: true };
  });
  const clean = host.api.clean({ steer: Infinity, gas: 20, brake: -3, buttons: { cross: 1, square: true } });
  assert.equal(clean.steer, 0); assert.equal(clean.gas, 1); assert.equal(clean.brake, 0); assert.equal(clean.buttons.cross, false); assert.equal(clean.buttons.square, true);
  const link = host.api.createHost({ onDisconnect: () => lost++ }); await host.flush();
  assert.equal(host.roots.lobbySettings.children[0].textContent, 'Try phone steering');
  await host.roots.lobbySettings.children[0].onclick(); await host.flush();
  const panel = host.roots.lobbySettings.children[1];
  assert.equal(host.scans[0], 'http://192.168.1.2:8766/phone.html#123456', 'QR encodes the controller address and current room');
  assert.equal(panel.children[5].hidden, false); assert.match(panel.children[5].innerHTML, /<svg/);
  assert.equal(panel.hidden, false); assert.equal(panel.children[1].textContent, '123456');
  assert.equal(panel.children[2].children.length, 1, 'unsafe link schemes are excluded');
  assert.equal(host.requests.find(r => r.path.includes('/state')).headers['X-Rover-Host'], 'secret');
  assert.equal(link.sample().gas, 0, 'neutral initial state arms controls');
  state = { ...state, steer: .6, gas: 1, down: { cross: true }, pressed: ['cross', 'unknown'] };
  await host.advance(50); assert.equal(link.sample().gas, 1); assert.equal(link.sample().pressed.length, 0, 'edges consumed once');
  link.clear(); await host.advance(50); assert.equal(link.sample().gas, 0, 'resume requires neutral controls');
  state = { ...state, steer: 0, gas: 0, down: {}, pressed: [] }; await host.advance(50); link.sample();
  state = { ...state, gas: .8 }; await host.advance(50); assert.equal(link.sample().gas, .8);
  host.jump(701); assert.equal(link.sample(), null, 'stale host samples drop even before the next poll');
  state = { connected: false }; await host.advance(50); assert.equal(link.sample(), null); assert.equal(lost, 1); link.sample(); assert.equal(lost, 1);
  state = { ok: false, status: 403, data: { error: 'Expired room' } }; await host.advance(50);
  assert.equal(host.roots.lobbySettings.children[0].textContent, 'Create new phone code');
  assert.equal(panel.children[2].children.length, 0); assert.equal(panel.children[5].hidden, true, 'expired pairing clears the QR');
  state = { connected: true, steer: 0, gas: 0, brake: 0, down: {}, pressed: [] };
  await host.roots.lobbySettings.children[0].onclick(); await host.flush();
  assert.equal(host.requests.filter(r => r.path.endsWith('/create')).length, 2, 'expired pairing can be recreated without reloading');
  link.close(); assert.equal(panel.hidden, true);

  let releaseOld;
  const controller = setup(req => {
    if (req.path.endsWith('/join')) return { controllerToken: 'token-' + req.data.room };
    if (req.data.room === '111111') return new Promise(resolve => { releaseOld = resolve; });
    return { ok: true };
  });
  const remote = controller.api.createController();
  await assert.rejects(remote.join('123'), /six-digit/);
  await remote.join('111111'); await controller.flush();
  await remote.join('222222'); await controller.flush();
  assert.ok(controller.requests.some(r => r.path.endsWith('/input') && r.data.room === '222222'), 'new room sends while old request is in flight');
  releaseOld({ ok: true }); await controller.flush();
  remote.setInput({ steer: -.75, gas: 1, buttons: { cross: true } });
  remote.setInput({ steer: -.75, gas: 1, buttons: { cross: false } });
  remote.setInput({ steer: 0, gas: 0, buttons: { cross: false } });
  await controller.advance(50); await controller.advance(0);
  const packets = controller.requests.filter(r => r.path.endsWith('/input') && r.data.room === '222222');
  assert.deepEqual(packets.slice(-2).map(r => r.data.buttons.cross), [true, false], 'quick press and release survive polling');
  assert.ok(packets.slice(-2).every(r => r.data.steer === 0 && r.data.gas === 0), 'queued button edges never replay stale steering or pedals');
  remote.release(); const beacon = JSON.parse(await controller.beacons.at(-1).body.text());
  assert.equal(beacon.gas, 0); assert.equal(beacon.steer, 0); assert.equal(beacon.buttons.cross, false);
  // Assignment changes and result ACKs travel on the existing heartbeat.
  const missions=[], assignment={id:'a11',runId:'run-1',world:'moon',paused:false};let active=assignment,ack=false;
  const missionClient=setup(req=>req.path.endsWith('/join')?{controllerToken:'mission-token'}:{ok:true,mission:active,missionAck:ack&&req.data.missionResult?req.data.missionResult.runId:null});
  const missionRemote=missionClient.api.createController({onMission:value=>missions.push(value)});
  await missionRemote.join('333333');await missionClient.flush();await missionClient.advance(50);
  assert.equal(missions.length,1,'unchanged heartbeat does not restart a task');assert.equal(missions[0].runId,'run-1');
  assert.equal(missionClient.requests.at(-1).data.taskReady,true);
  missionRemote.finishMission({runId:'run-1',ok:true});await missionClient.advance(50);await missionClient.advance(50);
  assert.equal(missionClient.requests.at(-1).data.missionResult.ok,true,'result retries until acknowledged');
  ack=true;await missionClient.advance(50);await missionClient.advance(50);
  assert.equal(missionClient.requests.at(-1).data.missionResult,null,'ACK retires completed result');
  active={...assignment,paused:true};await missionClient.advance(50);assert.equal(missions.at(-1).paused,true);
  active=null;await missionClient.advance(50);assert.equal(missions.at(-1),null,'host clear returns the phone to driving');
  missionRemote.release();const missionBeacon=JSON.parse(await missionClient.beacons.at(-1).body.text());assert.equal(missionBeacon.taskReady,true,'release preserves mission capability');assert.equal(missionBeacon.gas,0);assert.equal(missionBeacon.missionResult,undefined,'release cannot submit or overwrite a task result');
  // Context uses the host heartbeat and updates only when the screen changes.
  const screen={screen:'lobby',title:'Choose a world',selection:'Moon',canBack:false,canRead:false,canBook:false};
  const contexts=[];let activeContext=screen;
  const contextual=setup(req=>req.path.endsWith('/join')?{controllerToken:'context-token'}:{ok:true,context:activeContext});
  const contextRemote=contextual.api.createController({onContext:c=>contexts.push(c)});
  await contextRemote.join('444444');await contextual.flush();await contextual.advance(33);
  assert.equal(contexts.length,1,'identical context does not rebuild controls');
  const beforePress=contextual.requests.length;
  contextRemote.setInput({buttons:{right:true}});await contextual.advance(0);
  assert.equal(contextual.requests.length,beforePress+1,'menu press wakes sender without waiting for heartbeat');
  assert.equal(contextual.requests.at(-1).data.buttons.right,true);
  contextRemote.setInput({gas:1});await contextual.advance(0);
  assert.equal(contextual.requests.at(-1).data.gas,1,'pedal edge sends immediately');
  const sequenceBefore=contextual.requests.at(-1).data.sequence;
  contextRemote.release();await contextual.advance(0);
  assert.ok(contextual.requests.at(-1).data.sequence>sequenceBefore+1,'release beacon and subsequent input have ordered sequences');
  activeContext={...screen,screen:'drive'};await contextual.advance(33);assert.equal(contexts.at(-1).screen,'drive');
  link.setContext(screen);await host.roots.lobbySettings.children[0].onclick();await host.flush();
  assert.equal(host.requests.filter(r=>r.path==='/api/phone/state').at(-1).data.context.screen,'lobby');link.close();
  // A20ms round trip leaves13ms to the33ms target, not another fixed delay.
  let paced;
  paced=setup(req=>{if(req.path.endsWith('/join'))return{controllerToken:'paced'};paced.jump(20);return{ok:true};});
  const pacedRemote=paced.api.createController();await pacedRemote.join('555555');await paced.flush();
  const firstCount=paced.requests.length;await paced.advance(12);assert.equal(paced.requests.length,firstCount);
  await paced.advance(1);assert.equal(paced.requests.length,firstCount+1,'elapsed request time is subtracted from cadence');
  const staticPage = setup(() => ({ ok: false, data: { error: 'not found' } }));
  staticPage.api.createHost(); await staticPage.flush(); assert.equal(staticPage.roots.lobbySettings.children.length, 0, 'static hosting hides the experiment');
  console.log('Phone relay client pairing, neutral latch, edges, generation races, disconnect and release checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
