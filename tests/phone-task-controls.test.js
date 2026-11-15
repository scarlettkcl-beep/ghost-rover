const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Controls=require('../js/phone-task-controls.js');
let seed=12345;const math=Object.create(Math);math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const g=new Proxy({},{get:(t,k)=>k.startsWith('create')?()=>({addColorStop(){}}):()=>{},set:(t,k,v)=>(t[k]=v,true)});
const nodes=new Map();let doc;
function node(id){const events={},classes=new Set();return {id,ownerDocument:doc,style:{setProperty(k,v){this[k]=v;}},children:[],value:400,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,v){v?classes.add(x):classes.delete(x);}},appendChild(e){this.children.push(e);},replaceChildren(...e){this.children=e;},attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(n,f){(events[n]??=[]).push(f);},removeEventListener(n,f){events[n]=(events[n]||[]).filter(x=>x!==f);},dispatch(n,e={}){for(const f of events[n]||[])f({pointerId:1,clientX:300,preventDefault(){},stopImmediatePropagation(){},...e});},getBoundingClientRect:()=>({left:100,width:400}),setPointerCapture(){},getContext:()=>g,querySelector(s){if(!nodes.has(s))nodes.set(s,node(s));return nodes.get(s);}};}
doc=node('document');doc.createElement=tag=>node(tag);doc.getElementById=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};doc.defaultView=node('window');
const ctx=vm.createContext({document:doc,Math:math});
vm.runInContext(fs.readFileSync(require.resolve('../js/minigames/core.js'),'utf8')+'\nthis.tasks=Tasks;',ctx);
for(const f of fs.readdirSync(path.join(__dirname,'../js/minigames')).filter(x=>x.endsWith('.js')&&x!=='core.js'))vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/minigames',f),'utf8'),ctx);
const Tasks=ctx.tasks;
assert.deepEqual(Controls.ids().sort(),Array.from(Tasks.ids()).sort(),'every real task has a considered touch profile');
for(const id of Tasks.ids()){
 let result=null;Tasks.start(id,{pointerInput:false,onEnd:ok=>result=ok});
 const canvas=node('canvas'),root=node('root'),control=Controls.create({Tasks,canvas,root,taskId:id});
 const position=root.children.find(e=>e.className==='phone-task-position'),slider=position?.children.find(e=>e.className==='phone-task-slider'),button=root.children.find(e=>e.className==='phone-task-action');let down=false;
 for(let frame=0;Tasks.active()&&frame<1800;frame++){
  const state=Tasks.state(),target=state.aimX??400;
  if(slider){slider.value=target;slider.dispatch('input');}
  if(button && !!state.aimHold!==down){down=!!state.aimHold;button.dispatch(down?'pointerdown':'pointerup',{pointerId:2});}
  Tasks.step(1/60,control.sample(),true);
 }
 assert.equal(result,true,id+' finishes through real phone controls before assistance');control.destroy();assert.equal(root.children.length,0);assert.equal(control.sample().hold,false);
}
// Position touches and hold touches remain independent; pointer cancellation neutralizes.
Tasks.start('a11',{pointerInput:false});const canvas=node('canvas'),root=node('root'),control=Controls.create({Tasks,canvas,root,taskId:'a11'}),button=root.children.find(e=>e.className==='phone-task-action');
canvas.dispatch('pointerdown',{pointerId:3,clientX:400});assert.equal(Tasks.inp.px,600);assert.equal(control.sample().hold,false,'positioning does not fire an engine');
canvas.dispatch('pointerdown',{pointerId:4,clientX:100});assert.equal(Tasks.inp.px,600,'second canvas finger cannot steal steering');
button.dispatch('pointerdown',{pointerId:7});button.dispatch('pointerdown',{pointerId:8});assert.equal(control.sample().hold,true);button.dispatch('pointercancel',{pointerId:7});assert.equal(control.sample().hold,true);button.dispatch('lostpointercapture',{pointerId:8});assert.equal(control.sample().hold,false);
button.dispatch('pointerdown',{pointerId:7});doc.defaultView.dispatch('blur');assert.equal(control.sample().hold,false);control.destroy();button.dispatch('pointerdown');assert.equal(control.sample().hold,false);
Tasks.start('a17',{pointerInput:false});const c2=node('canvas'),r2=node('root'),controls2=Controls.create({Tasks,canvas:c2,root:r2,taskId:'a17'});c2.dispatch('pointerdown',{clientX:267.5});assert.equal(Tasks.inp.px,335);assert.equal(controls2.sample().hold,true,'touching a repair position both aims and holds');c2.dispatch('pointercancel');assert.equal(controls2.sample().hold,false);controls2.destroy();
Tasks.start('v2',{pointerInput:false});const c3=node('canvas'),r3=node('root'),controls3=Controls.create({Tasks,canvas:c3,root:r3,taskId:'v2'});c3.dispatch('pointerdown',{clientX:0});assert.equal(Tasks.inp.px,100);c3.dispatch('pointermove',{clientX:1000});assert.equal(Tasks.inp.px,700);assert.equal(controls3.sample().hold,false,'focus adjusts without a hold action');controls3.destroy();
Tasks.start('a11',{pointerInput:false});const c4=node('canvas'),r4=node('root');c4.getBoundingClientRect=()=>({left:100,width:600,height:225});const controls4=Controls.create({Tasks,canvas:c4,root:r4,taskId:'a11'});c4.dispatch('pointerdown',{clientX:300});assert.equal(Tasks.inp.px,200,'letterboxed canvas uses painted viewport rather than outer element');controls4.destroy();
console.log('All14 missions complete through touch control adapters before assistance; multi-touch, mapping, cancellation and narrow ranges pass');

// The low thumb controls remain usable without touching/covering the playfield.
Tasks.start('spi',{pointerInput:false});const c5=node('canvas'),r5=node('root'),controls5=Controls.create({Tasks,canvas:c5,root:r5,taskId:'spi'});
const position5=r5.children.find(e=>e.className==='phone-task-position'),slider5=position5.children.find(e=>e.className==='phone-task-slider'),button5=r5.children.find(e=>e.className==='phone-task-action'),cue5=button5.children.find(e=>e.className==='phone-task-action-cue');
assert.equal(r5.attributes['data-mode'],'dual');assert.deepEqual(controls5.profile.ends,['Turn right','Turn left'],'reversed mapping is labelled at both endpoints');
assert.equal(slider5.min,100);assert.equal(slider5.max,700,'steering range excludes saturated ends');
slider5.dispatch('pointerdown',{pointerId:10});slider5.value=530;slider5.dispatch('input');c5.dispatch('pointerdown',{pointerId:11,clientX:100});assert.equal(Tasks.inp.px,530,'canvas cannot steal a slider thumb');
button5.dispatch('pointerdown',{pointerId:12});assert.equal(cue5.textContent,'HOLDING','press feedback appears before animation sampling');assert.equal(controls5.sample().hold,true);
button5.dispatch('pointercancel',{pointerId:12});assert.equal(cue5.textContent,'HOLD');assert.equal(controls5.sample().hold,false);
slider5.dispatch('pointerup',{pointerId:10});c5.dispatch('pointerdown',{pointerId:11,clientX:300});assert.equal(Tasks.inp.px,400);slider5.value=100;slider5.dispatch('input');assert.equal(Tasks.inp.px,400,'native slider cannot fight an active canvas finger');assert.equal(slider5.value,400);
controls5.release();slider5.value=700;slider5.dispatch('input');assert.equal(Tasks.inp.px,700);assert.equal(slider5.attributes['aria-valuetext'],'100 percent');controls5.destroy();
Tasks.start('v1',{pointerInput:false});const c6=node('canvas'),r6=node('root'),controls6=Controls.create({Tasks,canvas:c6,root:r6,taskId:'v1'}),button6=r6.children.find(e=>e.className==='phone-task-action');
assert.equal(button6.attributes['aria-label'],'Hold to scoop soil');Tasks.state().carry=true;controls6.sample();assert.equal(button6.attributes['aria-label'],'Hold to pour into lab','action name follows the actual mission step');
button6.dispatch('keydown',{key:' '});assert.equal(controls6.sample().hold,true);button6.dispatch('blur');assert.equal(controls6.sample().hold,false);controls6.destroy();
console.log('Thumb layout, meaningful input ranges, immediate feedback, pointer ownership, dynamic labels and keyboard release pass');
