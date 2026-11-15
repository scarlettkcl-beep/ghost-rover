/* Integration checks execute the actual host flow functions against a small DOM/game fixture. */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/host.js'), 'utf8');
const between = (a,b) => source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const element = () => ({classList:{remove(){},add(){},toggle(){}},textContent:'',innerHTML:'',firstChild:{textContent:''},lastChild:{textContent:''},scrollTop:0,querySelector(){return this;}});
function fixture() {
  const els = new Map(), calls=[];
  const c={console,calls,Icons:{label(el,icon,text){el.textContent=text;}},$:id=>{if(!els.has(id))els.set(id,element());return els.get(id);},setTimeout(){},
    phoneMission:null,phoneLink:null,phoneState:null,document:{getElementById:()=>null},setCtrl(){},
    Tasks:{has:()=>true,start:(id,o)=>{c.taskEnd=o.onEnd;calls.push(['task',id,o.world]);}}, taskSite:null, taskPulse:0, taskSfx:{}, mode:'play',toastT:0,
    rover:{x:100,y:200,h:1,v:0}, worldKey:'moon',clock:{on:true,left:{moon:100,mars:200},free:{moon:false,mars:false}},
    WORLDS:{moon:{sites:[{id:'a11'},{id:'a14'}]},mars:{sites:[{id:'spirit'},{id:'viking'}]}},
    found:new Set(['a11']),tasksDone:new Set(),starsGot:new Set(),deepSeen:new Set(),cardSeen:new Set(),
    Pad:{rumble(){}},refreshPrompts(){},saveProgress(){calls.push(['save']);},toast(){},addTime:n=>{c.clock.left[c.worldKey]+=n;calls.push(['reward',n]);},openCard:(st,k)=>{calls.push(['card',st.id,k]);c.lastCard=st;},
    stopReading(){},card:null,cardKind:null,pendingSite:null,pendingPhase:null,pendingDeep:null,bookReturn:null,bookOpen:false,returnToBook:()=>calls.push(['book']),updateHud(){},confetti(){},Sfx:{cheer(){},music(){},init(){},click(){}},fmt:String,
    WORLD_DONE:{moon:{id:'moonDone'},mars:{id:'marsDone'}},DEEP:[{id:'d1'},{id:'d2'}],deepI:0,openDeep:()=>{c.mode='card';calls.push(['deep',c.deepI]);},
    beginCount:()=>calls.push(['count']),resetClock(){},setWorld:k=>{c.worldKey=k;c.sites=c.WORLDS[k].sites;calls.push(['world',k]);},hudEls:[],showClock(){},paintProgress(){},
    savedProgress:null,progressStarted:false,H:()=>0,camInit:true,openReport:()=>calls.push(['report'])
  };
  c.sites=c.WORLDS.moon.sites; c.WD={label:'The Moon',level:'Easy'};
  vm.createContext(c);
  vm.runInContext(between('  function startTask(', '  function stepTask('),c);
  return c;
}
let count=0;const test=(name,f)=>{f();count++;console.log('ok '+name);};
test('first task finish grants reward; repeating cannot farm time',()=>{const c=fixture();c.startTask({id:'a11'});c.taskEnd(true);assert.equal(c.clock.left.moon,110);assert.equal(c.tasksDone.has('a11'),true);c.startTask({id:'a11'},true);c.taskEnd(true);assert.equal(c.clock.left.moon,110);assert.deepEqual(c.calls.filter(x=>x[0]==='card').map(x=>x[2]),['site','review']);});
test('phone completion returns through the normal reward and story flow once',()=>{
 const c=fixture();c.phoneLink={sample:()=>({taskReady:true}),setMission:m=>c.assignment={...m},clearMission(){},ackMission:id=>c.calls.push(['ack',id])};
 c.Tasks.finish=ok=>{const end=c.taskEnd;c.taskEnd=null;if(end)end(ok);};c.Tasks.step=()=>c.calls.push(['desktopStep']);c.input=()=>({s:0,g:0});c.keys={};c.pad=null;
 vm.runInContext(between('  function stepTask(', '  // ---- button prompts'),c);
 c.startTask({id:'a11'});assert.equal(c.assignment.id,'a11');c.stepTask(.1);assert.equal(c.calls.some(x=>x[0]==='desktopStep'),false);
 c.phoneState={down:{},missionResult:{runId:'old',ok:true}};c.stepTask(.1);assert.equal(c.tasksDone.size,0);
 c.phoneState={down:{},missionResult:{runId:c.assignment.runId,ok:true}};c.stepTask(.1);
 assert.equal(c.clock.left.moon,110);assert.equal(c.pendingPhase,'story');assert.equal(c.calls.filter(x=>x[0]==='card').length,1);
 c.stepTask(.1);assert.equal(c.clock.left.moon,110);assert.equal(c.calls.filter(x=>x[0]==='card').length,1);
});
test('skipped task can later earn its first reward from the book',()=>{const c=fixture();c.startTask({id:'a11'});c.taskEnd(false);assert.equal(c.tasksDone.size,0);c.startTask({id:'a11'},true);c.taskEnd(true);assert.equal(c.clock.left.moon,110);assert.equal(c.tasksDone.has('a11'),true);});
test('replay credits the owning planet rather than the currently explored one',()=>{const c=fixture();c.found.add('spirit');c.startTask({id:'spirit'},true,'mars');c.taskEnd(true);assert.equal(c.clock.left.moon,100);assert.equal(c.clock.left.mars,210);});
test('closing a reviewed final sticker returns to book without advancing or resetting',()=>{const c=fixture();c.found.add('a14');c.card={id:'a11'};c.cardKind='review';vm.runInContext(between('  function closeCard()', '  function openDeep()'),c);c.closeCard();assert.equal(c.found.size,2);assert.deepEqual(c.calls,[['book']]);});
test('closing the final discovered story clears its checkpoint and opens world completion',()=>{const c=fixture();c.found.add('a14');c.pendingSite='a14';c.cardKind='site';vm.runInContext(between('  function closeCard()', '  function openDeep()'),c);c.closeCard();assert.equal(c.pendingSite,null);assert.ok(c.calls.some(x=>x[0]==='card'&&x[2]==='world'));});
function saved(overrides={}) {return {world:'moon',rover:{x:140,y:260,h:1.4},found:['a11','a14'],stars:[],tasks:[],deep:[],seen:[],pendingSite:'a14',clocks:{moon:{left:80,free:false},mars:{left:220,free:false}},...overrides};}
function continueFixture(data){const c=fixture();c.savedProgress=data;vm.runInContext(between('  function continueGame()', '  function newGame()'),c);return c;}
test('Continue restarts interrupted final task instead of skipping its story/completion',()=>{const c=continueFixture(saved());c.continueGame();assert.equal(c.pendingSite,'a14');assert.equal(c.rover.x,140);assert.ok(c.calls.some(x=>x[0]==='task'&&x[1]==='a14'));assert.equal(c.calls.some(x=>x[0]==='deep'),false);});
test('Continue resumes pending story directly after its task was already earned',()=>{const c=continueFixture(saved({tasks:['a14']}));c.continueGame();assert.ok(c.calls.some(x=>x[0]==='card'&&x[1]==='a14'&&x[2]==='site'));assert.equal(c.calls.some(x=>x[0]==='task'),false);});
test('Continue preserves world completion after final story was closed',()=>{const c=continueFixture(saved({pendingSite:null}));c.continueGame();assert.ok(c.calls.some(x=>x[0]==='card'&&x[2]==='world'));});
test('Continue resumes unread deep-space chapter after both worlds are finished',()=>{const c=continueFixture(saved({pendingSite:null,found:['a11','a14','spirit','viking'],deep:['d1']}));c.continueGame();assert.deepEqual(c.calls.find(x=>x[0]==='deep'),['deep',1]);});
test('completed campaign Continue returns to free exploration with the book accessible',()=>{const c=continueFixture(saved({pendingSite:null,found:['a11','a14','spirit','viking'],deep:['d1','d2']}));c.continueGame();assert.equal(c.mode,'play');assert.equal(c.clock.free.moon,true);assert.equal(c.calls.some(x=>x[0]==='deep'),false);});
test('last task first completion adds ten seconds to the final score',()=>{const c=fixture();c.timing=()=>false;vm.runInContext(between('  function addTime(', '  const timerBtn'),c);c.found.add('a14');c.startTask({id:'a14'});c.taskEnd(true);assert.equal(c.clock.left.moon,110);c.startTask({id:'a14'},true);c.taskEnd(true);assert.equal(c.clock.left.moon,110);});
test('free exploration and timer-off task completion do not change mission time',()=>{for(const setting of ['free','off']){const c=fixture();if(setting==='free')c.clock.free.moon=true;else c.clock.on=false;c.startTask({id:'a11'});c.taskEnd(true);assert.equal(c.clock.left.moon,100);assert.equal(c.tasksDone.has('a11'),true);}});
function checkpointFixture() {
  const c=fixture(), Progress=require('../js/progress.js'), memory=new Map();
  for(const w of Object.values(c.WORLDS))Object.assign(w,{lonMin:0,lonMax:100,latMin:0,latMax:100,ppd:100,timeLimit:180,stars:[],wrap:false});
  c.Progress=Progress;c.progress=Progress.create({getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},c.WORLDS,c.DEEP);c.progressStarted=true;c.saveFailed=false;
  vm.runInContext(between('  function saveProgress()', '\n\n  const toXY'),c);
  return c;
}
test('title world previews cannot overwrite exploration checkpoints on blur/pagehide',()=>{const c=checkpointFixture();c.saveProgress();const before=JSON.stringify(c.progress.load());c.mode='lobby';c.worldKey='mars';Object.assign(c.rover,{x:500,y:900});c.saveProgress();assert.equal(JSON.stringify(c.progress.load()),before);assert.equal(c.savedProgress.world,'moon');});
test('new-game countdown saves immediately even when starting from title',()=>{const c=checkpointFixture();c.mode='lobby';c.countT=0;c.countN=-1;vm.runInContext(between('  function beginCount()', '  function tickCount('),c);c.beginCount();assert.equal(c.mode,'count');assert.equal(c.progress.load().world,'moon');});
test('skip saves a story-phase checkpoint and Continue does not restart its task',()=>{const c=checkpointFixture();c.pendingSite='a11';c.startTask({id:'a11'});c.taskEnd(false);const checkpoint=c.progress.load();assert.equal(checkpoint.pendingPhase,'story');assert.equal(checkpoint.tasks.length,0);c.savedProgress=checkpoint;c.calls.length=0;vm.runInContext(between('  function continueGame()', '  function newGame()'),c);c.continueGame();assert.ok(c.calls.some(x=>x[0]==='card'&&x[1]==='a11'&&x[2]==='site'));assert.equal(c.calls.some(x=>x[0]==='task'),false);});
test('interrupted task remains task-phase after serialization and Continue restarts it',()=>{const c=checkpointFixture();c.pendingSite='a11';c.startTask({id:'a11'});c.saveProgress();c.savedProgress=c.progress.load();assert.equal(c.savedProgress.pendingPhase,'task');c.calls.length=0;vm.runInContext(between('  function continueGame()', '  function newGame()'),c);c.continueGame();assert.ok(c.calls.some(x=>x[0]==='task'&&x[1]==='a11'));});
test('review return restores exact sticker-book scroll and rover position',()=>{const c=fixture();c.bookOpen=true;c.$('book').scrollTop=740;vm.runInContext(between('  function reviewSite(', '  $("cardReplay").onclick'),c);c.toggleBook=y=>{c.bookOpen=true;c.$('book').scrollTop=y;};c.reviewSite({id:'a11'});assert.equal(c.bookReturn.scrollTop,740);c.$('book').scrollTop=0;c.rover.x=999;c.returnToBook();assert.equal(c.$('book').scrollTop,740);assert.equal(c.rover.x,100);assert.equal(c.bookOpen,true);});
test('Continue reopens the current deep-space card rather than skipping it after refresh',()=>{const c=continueFixture(saved({pendingSite:null,pendingDeep:'d1',found:['a11','a14','spirit','viking'],deep:['d1']}));c.continueGame();assert.deepEqual(c.calls.find(x=>x[0]==='deep'),['deep',0]);});
test('Continue reopens the final deep-space ending until it is explicitly closed',()=>{const c=continueFixture(saved({pendingSite:null,pendingDeep:'d2',found:['a11','a14','spirit','viking'],deep:['d1','d2']}));c.continueGame();assert.deepEqual(c.calls.find(x=>x[0]==='deep'),['deep',1]);assert.notEqual(c.mode,'play');});
test('closing the ending clears its pending checkpoint before returning to title',()=>{const c=fixture();c.pendingDeep='d2';c.cardKind='end';vm.runInContext(between('  function closeCard()', '  function openDeep()'),c);c.closeCard();assert.equal(c.pendingDeep,null);assert.equal(c.mode,'lobby');assert.ok(c.calls.some(x=>x[0]==='save'));});
test('Continue retains the saved world-completion score text',()=>{const c=continueFixture(saved({pendingSite:null}));c.continueGame();assert.equal(c.lastCard.wow,'Mission complete with 80 to spare! ⭐');});
console.log(count+' progress flow tests passed');
