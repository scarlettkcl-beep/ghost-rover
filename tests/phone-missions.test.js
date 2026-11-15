const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const nodes=new Map(),events={},frames=new Map(),steps=[],results=[],active=[],runs=[],reconnections=[];let n=0,current=null,dt=0,releases=0,destroys=0;
 function el(id=''){
  const classes=new Set(),x={id,hidden:false,disabled:false,inert:false,style:{},textContent:'',children:[],classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},setAttribute(){},append(...xs){xs.forEach(v=>this.appendChild(v));},appendChild(c){this.children.push(c);if(c.id)nodes.set(c.id,c);},remove(){nodes.delete(this.id);},querySelector(selector){return node(selector==='.taskbox'?'box':selector==='.taskhead'?'head':selector.replace('#',''));}};return x;
 }
 function node(id){if(!nodes.has(id))nodes.set(id,el(id));return nodes.get(id);}
 const doc={hidden:false,head:el('headroot'),body:el('body'),getElementById:id=>nodes.get(id)||null,createElement:()=>el(),addEventListener:(k,f)=>events['doc:'+k]=f,removeEventListener:(k)=>delete events['doc:'+k]};
 const tasks={inp:{},has:id=>['a11','v2'].includes(id),title:id=>id,active:()=>!!current,cancel(){current=null;node('task').classList.add('hidden');},start(id,options){current={id,options};runs.push(current);['task','box','head','taskKeys','taskHint','taskCv','taskSkip'].forEach(node);node('task').classList.remove('hidden');return true;},step(delta){dt+=delta;steps.push(delta);},finish(ok){const c=current;current=null;node('task').classList.add('hidden');c?.options.onEnd(ok);}};
 const ctx=vm.createContext({module:{exports:{}},document:doc,innerWidth:844,innerHeight:390,Tasks:tasks,PhoneTaskControls:{create(){return{profile:{hint:'Touch to play'},sample:()=>({hold:true}),release(){releases++;},destroy(){destroys++;}};}},addEventListener:(k,f)=>events[k]=f,removeEventListener:k=>delete events[k],requestAnimationFrame(f){frames.set(++n,f);return n;},cancelAnimationFrame:id=>frames.delete(id)});
 vm.runInContext(fs.readFileSync(require.resolve('../js/phone-missions.js'),'utf8'),ctx);
 const runtime=ctx.module.exports.create({onFinish:r=>results.push(r),onActive:a=>active.push(a),onReconnect:()=>reconnections.push(true)});
 return {runtime,tasks,node,doc,events,results,active,runs,reconnections,ctx,steps,get time(){return dt;},get releases(){return releases;},tick(now){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(f=>f(now));}};
}
const m=(runId='one',paused=false)=>({id:'a11',runId,world:'moon',paused});
{
 const f=fixture();assert.equal(f.active.length,0,'creation does not invoke caller callbacks');f.runtime.receive(m());assert.equal(f.runtime.active(),true);f.tick(0);f.tick(100);assert.equal(f.time,0,'no connection cannot advance task');
 f.runtime.setConnected(true);f.tick(200);f.tick(220);assert.ok(f.time>0);const elapsed=f.time;
 f.runtime.setMenuOpen(true);f.tick(240);assert.equal(f.time,elapsed,'phone menu freezes remote task before paused assignment arrives');f.runtime.setMenuOpen(false);
 f.runtime.receive(m('one',true));f.tick(260);assert.equal(f.time,elapsed,'computer pause freezes phone simulation');
 f.runtime.receive(m());assert.equal(f.runs.length,1,'same assignment never restarts');f.tick(280);assert.ok(f.time>elapsed);
 const old=f.time;f.runtime.setConnected(false);f.tick(350);assert.equal(f.time,old,'disconnect freezes time and releases');assert.ok(f.releases>0);assert.equal(f.node('phoneMissionBlocker').children[2].hidden,false);f.node('phoneMissionBlocker').children[2].onclick();assert.equal(f.reconnections.length,1);
 f.runtime.setConnected(true);f.ctx.innerWidth=390;f.ctx.innerHeight=844;f.events.resize();f.tick(400);assert.equal(f.time,old,'portrait freezes');f.ctx.innerWidth=844;f.ctx.innerHeight=390;f.events.resize();f.tick(450);f.tick(470);assert.ok(f.time>old);
 f.doc.hidden=true;f.events['doc:visibilitychange']();const hiddenTime=f.time;f.tick(500);f.doc.hidden=false;f.events['doc:visibilitychange']();f.tick(550);assert.equal(f.time,hiddenTime,'returning from background requires explicit resume');
 f.node('phoneMissionBlocker').children[1].onclick();f.tick(600);f.tick(620);assert.ok(f.time>hiddenTime);
 f.tasks.finish(true);assert.equal(f.results.length,1);assert.equal(f.results[0].ok,true);f.runtime.receive(m());f.tick(650);assert.equal(f.runs.length,1,'completed assignment waits for ACK instead of restarting');
 f.runs[0].options.onEnd(true);assert.equal(f.results.length,1,'duplicate completion callback ignored');
 f.runtime.receive(null);assert.equal(f.runtime.active(),false);assert.deepEqual(f.active,[true,false]);assert.equal(f.tasks.active(),false);
 f.runtime.destroy();
}
{
 const f=fixture();f.runtime.setConnected(true);f.runtime.receive(m('old'));const old=f.runs[0];f.runtime.receive({...m('new'),id:'v2'});old.options.onEnd(true);assert.equal(f.results.length,0,'replaced task cannot finish new mission');
 assert.equal(f.runs.length,2);f.runtime.receive({...m('new'),id:'a11'});assert.equal(f.runs.length,2,'run ID cannot swap task');
 f.runtime.receive(null);assert.equal(f.results.length,0,'cancelling does not award a completion');f.runtime.receive({id:'unknown',runId:'bad'});assert.equal(f.runtime.active(),false);f.runtime.destroy();
}
console.log('Phone mission lifecycle, handoff, pause, disconnect, portrait, visibility, cancellation and exactly-once completion passed');
