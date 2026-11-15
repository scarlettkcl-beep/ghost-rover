const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const Tilt=require('../js/tilt-steering.js');
// Generate physical device poses with the game's independent three.js rotation math.
const THREE = require('../lib/three.min.js');
function pose(base, axis, degrees) {
 const rad=Math.PI/180,q=new THREE.Quaternion().setFromEuler(new THREE.Euler(base.beta*rad,base.gamma*rad,base.alpha*rad,'ZXY'));
 q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis),degrees*rad));
 const e=new THREE.Euler().setFromQuaternion(q,'ZXY');return {alpha:e.z/rad,beta:e.x/rad,gamma:e.y/rad};
}
const poses=[{alpha:35,beta:0,gamma:0},{alpha:70,beta:12,gamma:65},{alpha:210,beta:-8,gamma:-78}];
test('steering follows the screen normal in flat and upright landscape holds',()=>{
 for(const base of poses)for(const screenAngle of [90,270]){
  let now=0;const t=Tilt.create({now:()=>now});t.enable();t.feed(base,screenAngle);assert.equal(t.sample().steer,0);
  now=20;t.feed(pose(base,[0,0,1],25),screenAngle);assert.ok(t.sample().steer<0,'counterclockwise screen turn steers left');
  for(let i=0;i<70;i++){now+=16;t.feed(pose(base,[0,0,1],25),screenAngle);t.sample();}assert.ok(t.sample().steer<-.99);
  t.calibrate();assert.equal(t.sample().steer,0);now+=20;t.feed(base,screenAngle);assert.ok(t.sample().steer>0,'clockwise turn steers right');
 }
});
test('forward/back and side tipping never become steering',()=>{
 for(const base of poses)for(const screenAngle of [90,270])for(const axis of [[1,0,0],[0,1,0]]){
  let now=0;const t=Tilt.create({now:()=>now});t.enable();t.feed(base,screenAngle);t.sample();
  for(const degrees of [-35,35]){now+=20;t.feed(pose(base,axis,degrees),screenAngle);assert.equal(t.sample().steer,0);}
 }
});
test('deadzone, angle wrapping and orientation changes preserve neutral',()=>{
 let now=0;const t=Tilt.create({now:()=>now});t.enable();const base={alpha:359,beta:0,gamma:0};t.feed(base,90);t.sample();
 now=16;t.feed(pose(base,[0,0,1],1),90);assert.equal(t.sample().steer,0);
 now=32;t.feed(pose(base,[0,0,1],20),90);const first=t.sample().steer;assert.ok(first<0&&first>-1,'steering eases in');
 now=48;t.feed(pose(base,[0,0,1],20),270);assert.equal(t.sample().steer,0,'rotating the screen re-centres');
 assert.equal(Tilt.wrap(359),-1);assert.equal(Tilt.orientationOf({alpha:null,beta:0,gamma:0}),null);
});
test('invalid readings, stale sensor and release reset immediately to neutral',()=>{
 let now=0;const t=Tilt.create({now:()=>now,staleMs:500});t.enable();t.feed({alpha:0,beta:0,gamma:0});now=20;t.feed({alpha:25,beta:0,gamma:0});assert.ok(t.sample().steer<0);
 now=600;assert.deepEqual(t.sample(),{ready:false,steer:0,reason:'stale'});t.feed({alpha:25,beta:0,gamma:0});assert.equal(t.sample().steer,0);
 t.feed({alpha:0,beta:null,gamma:25});assert.equal(t.sample().ready,false);t.feed({alpha:0,beta:0,gamma:0});t.reset();assert.equal(t.sample().steer,0);assert.equal(t.sample().ready,false);t.enable(false);assert.equal(t.sample().reason,'disabled');
});
test('permission request executes in the user gesture, with clear blocked cases',async()=>{
 let called=0,resolve;const permission=new Promise(r=>resolve=r),env={isSecureContext:true,DeviceOrientationEvent:{requestPermission(){called++;return permission;}}};
 const result=Tilt.requestAccess(env);assert.equal(called,1,'request is invoked before returning/awaiting');resolve('granted');assert.equal((await result).ok,true);
 assert.match((await Tilt.requestAccess({...env,isSecureContext:false})).message,/HTTPS/);assert.equal(called,1);
 assert.match((await Tilt.requestAccess({isSecureContext:true})).message,/no tilt sensor/);
 assert.match((await Tilt.requestAccess({isSecureContext:true,DeviceOrientationEvent:{requestPermission:async()=> 'denied'}})).message,/denied/);
 assert.equal((await Tilt.requestAccess({isSecureContext:true,DeviceOrientationEvent:function(){}})).ok,true);
 assert.equal((await Tilt.requestAccess({isSecureContext:true,DeviceOrientationEvent:{requestPermission(){throw Error();}}})).ok,false);
});
function phoneFixture(contextScreen = 'drive'){
 let now=0,frame,controllerOptions,missionOptions,menuBlocked=false;const events={},packets=[],elements=new Map(),releases=[];
 function element(id){if(elements.has(id))return elements.get(id);const handlers={},classes=new Set(),el={id,value:'',textContent:'',dataset:{},disabled:false,setAttribute(){},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);},contains:c=>classes.has(c)},style:{setProperty(){}},addEventListener(n,f){handlers[n]=f;},dispatch(n,p={}){return handlers[n]?.({preventDefault(){},pointerId:1,clientX:0,clientY:0,...p});},setPointerCapture(){},appendChild(){},remove(){},getContext:()=>new Proxy({},{get:()=>()=>{}})};elements.set(id,el);return el;}
 const doc={hidden:false,getElementById:element,createElement:()=>element('ripple'+Math.random()),body:{appendChild(){},classList:{toggle(){}}},addEventListener(n,f){events['document:'+n]=f;}};
 const c={console,Map,Set,Object,Math,Number,document:doc,performance:{now:()=>now},innerWidth:800,innerHeight:400,devicePixelRatio:1,screen:{orientation:{angle:90,addEventListener(n,f){events['screen:'+n]=f;}}},location:{hash:'#123456'},isSecureContext:true,DeviceOrientationEvent:{requestPermission:async()=> 'granted'},TiltSteering:Tilt,PhoneLink:{createController(options){controllerOptions=options;return {setInput:p=>packets.push(p),release:()=>releases.push(true),join:async()=>{},connected:()=>true};}},addEventListener(n,f){events[n]=f;},requestAnimationFrame:f=>{frame=f;},setTimeout:()=>0};c.window=c;
 c.PhoneMissions={create(options){missionOptions=options;return {setConnected(){},setMenuOpen(value){menuBlocked=value;},receive(value){options.onActive(!!value);}};}};
 // A local clock keeps sensor feed and RAF timestamps in the same domain.
 c.TiltSteering={...Tilt,create:()=>Tilt.create({now:()=>now})};vm.createContext(c);
 const html=fs.readFileSync(require.resolve('../phone.html'),'utf8'),code=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));vm.runInContext(code,c);
 if(contextScreen) controllerOptions.onContext({screen:contextScreen,title:'Test menu',selection:'Continue',canBack:true,canRead:true,canBook:true});
 return {mission:value=>controllerOptions.onMission(value),menuBlocked:()=>menuBlocked,context:value=>controllerOptions.onContext(value),c,events,packets,releases,element,advance(ms){now+=ms;frame(now);},last:()=>packets.at(-1)};
}
test('phone blocks driving before sensors and releases multi-touch input safely',async()=>{
 const f=phoneFixture();assert.equal(f.element('room').value,'123456');f.element('drive').dispatch('pointerdown');f.advance(60);assert.equal(f.last().gas,0);
 await f.element('enable').onclick();f.events.deviceorientation({alpha:0,beta:0,gamma:0});f.advance(60);assert.equal(f.element('calibrate').disabled,false);f.element('startDriving').onclick();
 f.element('drive').dispatch('pointerdown',{pointerId:1});f.element('drive').dispatch('pointerdown',{pointerId:2});assert.equal(f.last().gas,1);f.element('drive').dispatch('pointerup',{pointerId:1});assert.equal(f.last().gas,1);f.element('drive').dispatch('pointercancel',{pointerId:2});assert.equal(f.last().gas,0);
 f.element('reverse').dispatch('pointerdown',{pointerId:3});f.element('square').dispatch('pointerdown',{pointerId:4});assert.equal(f.last().brake,1);assert.equal(f.last().buttons.square,true);
 f.events.blur();f.advance(60);assert.equal(f.last().brake,0);assert.equal(f.last().buttons.square,false);assert.equal(f.last().steer,0);
});
test('stale sensors and portrait transitions cannot retain a pedal',async()=>{
 const f=phoneFixture();await f.element('enable').onclick();f.events.deviceorientation({alpha:0,beta:0,gamma:0});f.advance(60);f.element('startDriving').onclick();f.element('drive').dispatch('pointerdown');assert.equal(f.last().gas,1);f.advance(1200);assert.equal(f.last().gas,0);assert.ok(f.releases.length>0);
 f.events.deviceorientation({alpha:0,beta:0,gamma:0});f.advance(60);assert.equal(f.last().gas,0,'restoring motion never restores an old held pedal');f.element('drive').dispatch('pointerdown');f.c.innerWidth=400;f.c.innerHeight=800;f.events.resize();f.advance(60);assert.equal(f.last().gas,0);assert.equal(f.last().steer,0);
});

test('setup blocks pedals and reopening it releases live driving',async()=>{
 const f=phoneFixture();await f.element('enable').onclick();f.events.deviceorientation({alpha:0,beta:0,gamma:0});f.advance(60);
 f.element('drive').dispatch('pointerdown');assert.equal(f.last().gas,0,'setup covers and disables live pedals');
 f.element('startDriving').onclick();f.element('drive').dispatch('pointerdown');assert.equal(f.last().gas,1);
 f.element('setupToggle').onclick();f.advance(60);assert.equal(f.last().gas,0);assert.equal(f.element('setup').hidden,false);
});

test('phone menus use explicit arrows without motion and context switches disarm holds',async()=>{
 const f=phoneFixture('lobby');
 assert.equal(f.element('controllerDeck').hidden,true);assert.equal(f.element('menuDeck').hidden,false);
 f.element('menuRight').dispatch('pointerdown');assert.equal(f.last().buttons.right,true);assert.equal(f.last().steer,0);assert.equal(f.last().gas,0);
 f.element('menuRight').dispatch('pointerup');assert.equal(f.last().buttons.right,false);
 f.element('menuSelect').dispatch('pointerdown');assert.equal(f.last().buttons.cross,true);
 f.context({screen:'drive',title:'Drive'});f.advance(16);assert.equal(f.last().buttons.cross,false);assert.equal(f.element('menuDeck').hidden,true);
 await f.element('enable').onclick();f.events.deviceorientation({alpha:0,beta:0,gamma:0});f.advance(16);f.element('startDriving').onclick();
 f.element('drive').dispatch('pointerdown');assert.equal(f.last().gas,1);
 f.context({screen:'pause',title:'Paused',selection:'Resume',canBack:true,canRead:false});f.advance(16);assert.equal(f.last().gas,0);assert.equal(f.last().steer,0);assert.equal(f.element('menuSelection').textContent,'Resume');
 f.element('menuRead').dispatch('pointerdown');assert.equal(f.last().buttons.triangle,false,'hidden context actions cannot send');
 f.element('menuDown').dispatch('pointerdown');assert.equal(f.last().buttons.down,true);
 f.context({screen:'count',title:'Ready?'});f.advance(16);assert.equal(f.last().buttons.down,false);assert.equal(f.element('menuDirections').hidden,true);
});
test('phone starts in a safe waiting menu before host context arrives',()=>{
 const f=phoneFixture(null);f.element('setupClose').onclick();f.element('drive').dispatch('pointerdown');f.advance(16);
 assert.equal(f.last().gas,0);assert.equal(f.element('controllerDeck').hidden,true);assert.equal(f.element('menuDirections').hidden,true);
});

test('host pause menus remain usable during a phone mission without clearing it',()=>{
 const f=phoneFixture('task');f.mission({id:'a11',runId:'mission'});
 assert.equal(f.element('menuDeck').hidden,true);assert.equal(f.menuBlocked(),false);
 f.context({screen:'pause',title:'Paused',selection:'Resume',canBack:true});
 assert.equal(f.element('menuDeck').hidden,false);assert.equal(f.element('hostView').hidden,true);assert.equal(f.menuBlocked(),true);
 f.element('menuSelect').dispatch('pointerdown');assert.equal(f.last().buttons.cross,true);
 f.context({screen:'task',title:'Land the Eagle!'});f.advance(16);
 assert.equal(f.element('menuDeck').hidden,true);assert.equal(f.element('hostView').hidden,false);assert.equal(f.menuBlocked(),false);assert.equal(f.last().buttons.cross,false);
});
