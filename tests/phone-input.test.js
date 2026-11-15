/* Local phone experiment: execute the host's real input/actions with a fake link. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../js/host.js'),'utf8');
const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const calls=[],keys={},nodes=new Map();let disconnect,remote=null,overlay=null,focused=null,clears=0;
const element=()=>({tagName:'BUTTON',dataset:{},innerHTML:'',textContent:'',classList:{toggle(){}},setAttribute(){},click(){calls.push(['action','next']);}}),node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
const link={sample(){if(!remote)return null;const next={...remote,pressed:remote.pressed||[]};remote.pressed=[];return next;},clear(){clears++;}};
const ctx=vm.createContext({calls,keys,rover:{steer:1},taskPulse:0,Tasks:{inp:{hold:true,press:true,mouseHold:true,x:1},step:(dt,inp)=>calls.push(['task',inp]),steerOnly:()=>false},
 PhoneLink:{createHost(options){disconnect=options.onDisconnect;return link;}},
 Sfx:{init:()=>calls.push(['init'])},overlayNow:()=>overlay,GameUI:{visible:el=>!!el&&!el.disabled&&!el.hidden,activateFocused(o,fallback){if(focused)focused.click();else fallback();}},
 action:a=>calls.push(['action',a]),clearFocus:()=>calls.push(['clearFocus']),moveFocus:d=>calls.push(['focus',d]),
 document:{querySelectorAll:()=>[],getElementById:node},$:node,cardKind:'site',graphicsBlocked:false,mode:'play',Prompts:require('../js/prompts.js'),
 openPause:msg=>{calls.push(['paused',msg]);ctx.clearHeldInput();},toast:msg=>calls.push(['toast',msg])});
const run=code=>vm.runInContext(code,ctx);
run(between('  let pad = null, ctrlNow =', '  function updateKb('));
run('function setCtrl(kind){ctrlNow=kind;calls.push(["ctrl",kind]);}');
run(between('  function input()', '  // ---- game controller:'));
run(between('  function phoneSelectedButton(', '  addEventListener("gamepadconnected"'));
run(between('  function clearHeldInput()', '  function pauseForFocusLoss('));
run(between('  function lostInput(', '  // ---- pause menu'));
run(between('  function stepTask(', '  // ---- button prompts'));
const state=(s=0,g=0,r=0,pressed=[],cross=false)=>({steer:s,gas:g,brake:r,down:{cross},pressed});
const result=()=>Array.from(run('Object.values(input())'));
assert.deepEqual(result(),[0,0,0]);
keys.w=true;run('kbSteer=.45;pad={steer:-.8,gas:.3,brake:.2};');remote=state(.6,.65,.7);ctx.pollPhone(0);
assert.deepEqual(result(),[-.8,1,.7],'strongest steering, accelerator and brake remain independently usable');
delete keys.w;run('kbSteer=-.2;pad=null');remote=state(.9,.5,0);ctx.pollPhone(1);assert.deepEqual(result(),[.9,.5,0]);assert.equal(run('ctrlNow'),'phone');
remote=state();ctx.pollPhone(2);keys.arrowdown=true;run('kbSteer=-.5');assert.deepEqual(result(),[-.5,0,1]);assert.equal(run('ctrlNow'),'kb');delete keys.arrowdown;
// Presses are consumed once, while held Cross remains available to task input.
calls.length=0;remote=state(0,0,0,['cross','circle','triangle','square','options']);ctx.pollPhone(3);ctx.pollPhone(4);
assert.deepEqual(calls.filter(c=>c[0]==='action').map(c=>c[1]),['next','back','read','book','pause']);
let clicks=0;focused={tagName:'BUTTON',click(){clicks++;}};ctx.document.activeElement=focused;overlay={contains:e=>e===focused};remote=state(0,0,0,['cross']);ctx.pollPhone(5);assert.equal(clicks,1,'Cross activates a focused native menu button');focused=null;ctx.document.activeElement=null;
// Menus ignore gyro entirely; explicit directional edges advance exactly once.
calls.length=0;remote=state(.8,1,1);ctx.pollPhone(1000);ctx.pollPhone(1100);remote=state(-.8);ctx.pollPhone(1300);
assert.deepEqual(calls.filter(c=>c[0]==='focus'),[],'tilting never changes menu focus');
run('kbSteer=0;pad=null');assert.deepEqual(result(),[0,0,0],'menu packets cannot leave driving axes armed');
remote=state(.9,0,0,['right']);ctx.pollPhone(1301);ctx.pollPhone(1400);remote=state(-.9,0,0,['left','up','down']);ctx.pollPhone(1401);
assert.deepEqual(calls.filter(c=>c[0]==='focus').map(c=>c[1]),[1,-1,-1,1]);
overlay=null;calls.length=0;remote=state(0,0,0,['left']);ctx.pollPhone(1600);assert.equal(calls.some(c=>c[0]==='focus'),false,'driving does not consume menu arrows');
overlay={};ctx.mode='task';remote=state(0,0,0,['right']);ctx.pollPhone(1700);assert.equal(calls.some(c=>c[0]==='focus'),false,'mission input never navigates buttons');
ctx.graphicsBlocked=true;remote=state(0,0,0,['right']);ctx.pollPhone(1701);assert.equal(calls.some(c=>c[0]==='focus'),true,'graphics recovery still accepts explicit phone arrows from a task');ctx.graphicsBlocked=false;
remote=state(0,0,0,[],true);ctx.pollPhone(1800);run('kbSteer=0;pad=null;taskPulse=0');ctx.stepTask(.02);assert.equal(calls.at(-1)[1].hold,true);remote=state();ctx.pollPhone(1801);ctx.stepTask(.02);assert.equal(!!calls.at(-1)[1].hold,false);
// Focus loss, pause and resume clear remote axes as well as keyboard/task holds.
remote=state(.9,1,0);ctx.pollPhone(1900);keys.w=true;ctx.clearHeldInput();assert.equal(run('phoneState'),null);assert.equal(clears,1);assert.equal(Object.keys(keys).length,0);assert.equal(ctx.Tasks.inp.mouseHold,false);assert.deepEqual(result(),[0,0,0]);
// Only loss of the currently used phone pauses the mission; stale values disappear either way.
calls.length=0;ctx.mode='play';run('ctrlNow="kb";phoneState={steer:1,gas:1,brake:0}');disconnect('Gone');assert.equal(run('phoneState'),null);assert.equal(calls.some(c=>c[0]==='paused'),false);
run('ctrlNow="phone";phoneState={steer:1,gas:1,brake:0}');disconnect('Phone timed out');assert.equal(run('phoneState'),null);assert.deepEqual(calls.find(c=>c[0]==='paused'),['paused','Phone timed out']);assert.equal(clears,2);
ctx.mode='card';calls.length=0;disconnect('Phone timed out');assert.equal(calls.some(c=>c[0]==='paused'),false);assert.equal(calls.some(c=>c[0]==='toast'),true);
// Actual prompt rendering takes the controller-shaped branch without losing touch labels.
run(between('  function refreshPrompts()', '  function input()'));run('ctrlNow="phone"');ctx.refreshPrompts();
for(const id of ['cardKeys','reportKeys','bookKeys','pauseKeys','taskKeys'])assert.ok(node(id).innerHTML && !node(id).innerHTML.includes('undefined'),id+' has phone prompts');
assert.match(node('taskKeys').innerHTML,/Tilt phone/);assert.match(node('pauseKeys').innerHTML,/Arrow buttons/);assert.doesNotMatch(node('pauseKeys').innerHTML,/Tilt phone/);assert.equal(node('cardNext').dataset.key,'Select');assert.equal(ctx.Prompts.label('phone','drive'),'Drive');
assert.match(source,/graphicsBlocked\) \{ pollPad\(\); pollPhone\(now\)/);assert.match(source,/pollPad\(\); pollPhone\(now\); tickCardWait/);
console.log('Phone input merge, presses, explicit menu arrows, task hold, disarm, disconnect safety and touch prompts passed');

// Remote task execution must freeze desktop simulation and consume one matching result.
link.ackMission=id=>calls.push(['ack',id]);link.clearMission=()=>calls.push(['clearMission']);ctx.Tasks.finish=ok=>calls.push(['finish',ok]);
run('phoneMission={runId:"current"};phoneState={missionResult:{runId:"old",ok:true}}');calls.length=0;ctx.stepTask(.02);
assert.equal(calls.length,0,'remote ownership freezes desktop simulation and ignores stale result');
run('phoneState={missionResult:{runId:"current",ok:true}}');ctx.stepTask(.02);
assert.deepEqual(calls,[['ack','current'],['finish',true]]);assert.equal(run('phoneMission'),null);
// A disconnect discards remote ownership and pauses before desktop takeover.
node('task').classList.remove=()=>{};calls.length=0;run('phoneMission={runId:"lost"};ctrlNow="phone"');ctx.mode='task';disconnect('Gone');
assert.equal(run('phoneMission'),null);assert.equal(calls.filter(c=>c[0]==='clearMission').length,1);assert.equal(calls.filter(c=>c[0]==='paused').length,1);

// Published context mirrors the real overlay rather than only the driving mode.
const contexts=[];link.setContext=c=>contexts.push(c);ctx.mode='play';overlay=null;remote=null;ctx.pollPhone(2000);assert.equal(contexts.at(-1).screen,'drive');assert.equal(contexts.at(-1).canBook,true);
for(const [id,screen] of [['lobby','lobby'],['card','story'],['book','book'],['pause','pause'],['report','report'],['howto','howto'],['newGameConfirm','confirm'],['graphicsRecovery','recovery'],['task','task']]){
 overlay={id,contains:e=>e===focused};ctx.mode=id==='task'?'task':'play';ctx.pollPhone(2001);assert.equal(contexts.at(-1).screen,screen);
}
ctx.mode='count';overlay=null;ctx.pollPhone(2002);assert.equal(contexts.at(-1).screen,'count');assert.equal(contexts.at(-1).canBack,false);
overlay={id:'card',contains:e=>e===focused};ctx.mode='card';node('cardNext').disabled=true;ctx.pollPhone(2003);assert.equal(contexts.at(-1).canBack,false,'reading delay cannot be bypassed');assert.equal(contexts.at(-1).canRead,true);
focused={tagName:'BUTTON',textContent:'  Go to Mars  ',getAttribute:()=>null};ctx.document.activeElement=focused;ctx.pollPhone(2004);assert.equal(contexts.at(-1).selection,'Go to Mars');
focused=null;ctx.document.activeElement=null;ctx.mode='pause';overlay={id:'pause',contains:()=>false};run('phoneMission={runId:"paused"};');calls.length=0;remote=state(1,0,0,['right','cross']);ctx.pollPhone(2005);assert.ok(calls.some(x=>x[0]==='focus'&&x[1]===1));assert.ok(calls.some(x=>x[0]==='action'&&x[1]==='next'),'remote task pause allows menu selection');
console.log('Context publication covers driving, countdown, all menu surfaces, focused labels and paused remote tasks');

// The phone advertises and activates the same visible default button.
run('phoneMission=null');ctx.mode='lobby';focused=null;ctx.document.activeElement=null;overlay={id:'lobby',contains:()=>false};node('continueBtn').textContent='Continue Moon';node('continueBtn').hidden=false;node('kbStart').textContent='START';node('kbStart').hidden=true;
let continued=0,started=0;node('continueBtn').click=()=>continued++;node('kbStart').click=()=>started++;
remote=state(0,0,0,['cross']);ctx.pollPhone(2100);assert.equal(contexts.at(-1).selection,'Continue Moon');assert.equal(continued,1);assert.equal(started,0);
node('continueBtn').hidden=true;node('kbStart').hidden=false;remote=state(0,0,0,['cross']);ctx.pollPhone(2101);assert.equal(contexts.at(-1).selection,'START');assert.equal(started,1);
focused={tagName:'BUTTON',dataset:{world:'moon'},textContent:'MoonLevel1Easy',innerText:'Moon\nLevel 1 · Easy',getAttribute:()=>null};ctx.document.activeElement=focused;overlay.contains=e=>e===focused;ctx.pollPhone(2102);assert.equal(contexts.at(-1).selection,'Choose Moon');
focused={tagName:'BUTTON',dataset:{},textContent:'SoundOn',innerText:'Sound: On',getAttribute:()=>null};ctx.document.activeElement=focused;ctx.pollPhone(2103);assert.equal(contexts.at(-1).selection,'Sound: On','rendered text keeps useful word boundaries');
focused.hidden=true;ctx.pollPhone(2104);assert.equal(contexts.at(-1).selection,'START','stale hidden focus is not advertised');
focused=null;ctx.document.activeElement=null;overlay={id:'card',contains:()=>false};ctx.mode='card';node('cardNext').disabled=true;ctx.pollPhone(2105);assert.equal(contexts.at(-1).selection,'Please wait…');
console.log('Visible Continue/Start fallback, matching activation, planet labels and hidden/disabled selection pass');
