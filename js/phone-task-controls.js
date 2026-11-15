/* Touch adapters for the existing mission simulations. No rover/gyro input leaks into tasks. */
const PhoneTaskControls = (() => {
  const profiles = {
    a11: {mode:'dual', positionLabel:'Landing position', positionIcon:'position', ends:['Left','Right'], actionIcon:'engine', actionLabel:'Fire engine', hint:'Left thumb: slide toward the clear spot. Right thumb: hold to slow down; release to descend.'},
    s3: {mode:'hold', actionIcon:'engine', actionLabel:'Fire engines', hint:'Hold to slow your descent. Release to fall. Keep the speed gauge in the green at touchdown.'},
    a14s: {mode:'slider', positionLabel:'Mirror angle', positionIcon:'mirror', ends:['Tilt left','Tilt right'], hint:'Slide to bounce the beam back to Earth. Let go when the signal locks.'},
    a15: {mode:'target', positionLabel:'Rover part', positionIcon:'position', ends:['Left','Right'], actionIcon:'tool', actionLabel:['Lower rover','Unfold wheels','Unfold wheels','Fit seats'], hint:'Touch and hold the glowing part. Or aim below, then hold the yellow button.'},
    a16: {mode:'dual', inputRange:[190,610], positionLabel:'Steering', positionIcon:'steer', ends:['Left','Right'], actionIcon:'drive', actionLabel:'Drive', hint:'Left thumb: steer around the cones. Right thumb: hold Drive; release to slow down.'},
    a17: {mode:'target', positionLabel:'Repair position', positionIcon:'position', ends:['Left','Right'], actionIcon:'tool', actionLabel:['Tape crack','Tape crack','Fit map','Clamp patch'], hint:'Touch and hold the glowing repair. Move to the next spot when its ring fills.'},
    ing: {mode:'dual', inputRange:[30,770], positionLabel:'Flight position', positionIcon:'position', ends:['Left','Right'], actionIcon:'lift', actionLabel:'Lift', hint:'Left thumb: slide toward the ring. Right thumb: hold to rise; release to drift down.'},
    ins: {mode:'target', positionLabel:'Robot arm', positionIcon:'arm', ends:['Left','Right'], actionIcon:'grab', actionLabel:['Grab instrument','Lower instrument','Grab shield','Lower shield'], hint:'Hold the glowing object to grab it. Slide the arm across, then hold over the glowing landing spot.'},
    opp: {mode:'slider', inputRange:[70,730], positionLabel:'Rover position', positionIcon:'position', ends:['Left','Right'], hint:'Slide into a glowing gust. Follow the moving wind to clear the solar panels.'},
    phx: {mode:'target', positionLabel:'Scoop position', positionIcon:'arm', ends:['Left','Right'], actionIcon:'scoop', actionLabel:s=>s.stage?'Collect ice':'Scrape trench', hint:'Touch and hold the trench to scrape three layers. Then hold the bright ice before it fades.'},
    soj: {mode:'target', positionLabel:'Deployment part', positionIcon:'position', ends:['Left','Right'], actionIcon:'tool', actionLabel:['Deflate airbags','Lower ramp','Roll down ramp'], hint:'Touch and hold the glowing airbags, ramp, then rover. Follow the next glowing spot.'},
    spi: {mode:'dual', inputRange:[100,700], positionLabel:'Reversed steering', positionIcon:'steer', ends:['Turn right','Turn left'], actionIcon:'reverse', actionLabel:'Drive backward', hint:'Steering is reversed: slide left to turn right. Hold Drive backward to move toward the flag.'},
    v1: {mode:'target', positionLabel:'Scoop position', positionIcon:'arm', ends:['Left','Right'], actionIcon:'scoop', actionLabel:s=>s.carry?'Pour into lab':'Scoop soil', hint:'Hold the soil to scoop. Slide to the lab, then hold to pour. Collect two samples.'},
    v2: {mode:'slider', positionLabel:'Camera focus', positionIcon:'camera', ends:['Near','Far'], hint:'Slide slowly until the frost is sharp. Let go to keep the focus steady while it locks.'}
  };
  // Simple line icons match the game's drawn controls; labels carry the meaning.
  const iconPaths={
    position:'<path d="M4 16h24M9 11l-5 5 5 5m14-10 5 5-5 5"/><circle cx="16" cy="16" r="4"/>',
    steer:'<circle cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="4"/><path d="m5 12 8 3m14-3-8 3m-3 5v8"/>',
    engine:'<path d="M10 4h12l3 14H7zM11 22l2 6m8-6-2 6m-3-7v9"/>',
    drive:'<rect x="9" y="4" width="14" height="24" rx="4"/><path d="M13 10h6m-6 5h6m-6 5h6"/>',
    reverse:'<path d="M25 24V14a6 6 0 0 0-6-6H5m6-5L5 8l6 5M20 24h10"/>',
    lift:'<path d="M4 7h24M16 3v12m-6-1h12v9H10zM7 28l3-5m15 5-3-5M5 18v-5m-3 3 3-3 3 3m19 2v-5m-3 3 3-3 3 3"/>',
    tool:'<path d="M25 3a9 9 0 0 0-11 11L4 24a3 3 0 0 0 4 4l10-10A9 9 0 0 0 29 7l-6 6-4-4z"/>',
    arm:'<path d="M3 28h12M8 28V17l9-8 10 8m-4-3-3 8 6 4 4-6"/><circle cx="8" cy="17" r="3"/><circle cx="17" cy="9" r="3"/>',
    grab:'<path d="M16 3v10m-2 0H9l-6 9 6 7m9-16h5l6 9-6 7M9 22h14v8H9z"/>',
    scoop:'<path d="m6 4 13 14M3 7l6-6m7 14 12 8-8 7-8-11z"/>',
    camera:'<path d="M4 10h5l3-5h8l3 5h5v17H4z"/><circle cx="16" cy="18" r="6"/>',
    mirror:'<path d="m6 7 22 12M16 13v14m-7 0h14M4 2l5 9m-5-2 5 2 2-5m12-3-4 8"/>'
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function getProfile(id) { return profiles[id] || null; }
  function create({Tasks,canvas,root,taskId}) {
    const profile=getProfile(taskId);if(!profile)throw Error('No phone controls for mission '+taskId);
    const doc=root.ownerDocument || document, bindings=[],holds=new Set();let owner=null,sliderOwner=null,destroyed=false;
    const range=profile.inputRange || (Tasks.pointerRange?Tasks.pointerRange():taskId==='v2'?[100,700]:[0,800]);
    const make=(tag,cls,text)=>{const e=doc.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
    const icon=name=>{const e=make('span','phone-task-icon');e.setAttribute('aria-hidden','true');e.innerHTML='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">'+iconPaths[name]+'</svg>';return e;};
    const hint=make('p','phone-task-hint',profile.hint),position=make('div','phone-task-position'),label=make('label','phone-task-slider-label'),slider=make('input','phone-task-slider'),action=make('button','phone-task-action');
    const actionName=make('span','phone-task-action-name'),actionCue=make('span','phone-task-action-cue','HOLD');
    hint.id='phone-task-help';slider.id='phone-task-position';label.setAttribute('for',slider.id);
    slider.type='range';slider.min=range[0];slider.max=range[1];slider.step='1';slider.value=clamp(Tasks.inp.px,...range);slider.setAttribute('aria-label',profile.positionLabel || 'Mission position');slider.setAttribute('aria-describedby',hint.id);
    action.type='button';action.setAttribute('aria-label','Hold to perform mission action');action.setAttribute('aria-describedby',hint.id);
    actionCue.setAttribute('aria-hidden','true');
    if(profile.positionLabel){label.appendChild(icon(profile.positionIcon));label.appendChild(make('span','phone-task-position-name',profile.positionLabel));position.appendChild(label);position.appendChild(slider);const ends=make('div','phone-task-endpoints');ends.setAttribute('aria-hidden','true');for(const text of profile.ends)ends.appendChild(make('span','',text));position.appendChild(ends);}
    root.replaceChildren();
    if(profile.mode!=='hold')root.appendChild(position);
    root.appendChild(hint);
    if(profile.actionLabel){action.appendChild(icon(profile.actionIcon));action.appendChild(actionName);action.appendChild(actionCue);root.appendChild(action);}
    root.classList.add('phone-task-deck');root.setAttribute('data-mode',profile.mode);
    const on=(el,type,fn,options)=>{el.addEventListener(type,fn,options);bindings.push(()=>el.removeEventListener(type,fn,options));};
    const feedback=()=>{const held=holds.size>0;action.classList.toggle('held',held);actionCue.textContent=held?'HOLDING':'HOLD';};
    const move=value=>{const numeric=Number(value);if(!Number.isFinite(numeric))return;Tasks.inp.px=clamp(numeric,...range);Tasks.inp.mouse=true;slider.value=Tasks.inp.px;const pct=(Tasks.inp.px-range[0])/(range[1]-range[0])*100;slider.style.setProperty('--position',pct+'%');slider.setAttribute('aria-valuetext',Math.round(pct)+' percent');};
    const at=e=>{const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/800,(r.height||r.width*450/800)/450);if(scale>0){const left=r.left+(r.width-800*scale)/2;move((e.clientX-left)/scale);}};
    function release(){holds.clear();owner=null;sliderOwner=null;Tasks.inp.mouseHold=false;Tasks.inp.hold=false;Tasks.inp.press=false;feedback();}
    function stop(e){e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}
    on(canvas,'pointerdown',e=>{if(destroyed||owner!==null||sliderOwner!==null||profile.mode==='hold')return;stop(e);owner=e.pointerId;at(e);if(profile.mode==='target')holds.add('canvas:'+owner);feedback();try{canvas.setPointerCapture(owner);}catch(_){} });
    on(canvas,'pointermove',e=>{if(e.pointerId===owner){stop(e);at(e);}});
    const canvasUp=e=>{if(e.pointerId!==owner)return;holds.delete('canvas:'+owner);owner=null;feedback();};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])on(canvas,type,canvasUp);
    on(slider,'pointerdown',e=>{if(owner!==null||sliderOwner!==null){e.preventDefault();return;}sliderOwner=e.pointerId;});
    const sliderUp=e=>{if(e.pointerId===sliderOwner)sliderOwner=null;};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])on(slider,type,sliderUp);
    on(slider,'input',()=>{if(owner===null)move(slider.value);else slider.value=Tasks.inp.px;});
    on(action,'pointerdown',e=>{if(destroyed)return;stop(e);holds.add('action:'+e.pointerId);feedback();try{action.setPointerCapture(e.pointerId);}catch(_){} });
    const actionUp=e=>{holds.delete('action:'+e.pointerId);feedback();};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])on(action,type,actionUp);
    on(action,'keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();holds.add('keyboard');feedback();}});
    on(action,'keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();holds.delete('keyboard');feedback();}});
    on(action,'blur',()=>{holds.delete('keyboard');feedback();});
    on(canvas,'contextmenu',e=>e.preventDefault());on(action,'contextmenu',e=>e.preventDefault());
    const win=doc.defaultView;if(win)on(win,'blur',release);on(doc,'visibilitychange',()=>{if(doc.hidden)release();});
    function sample(){
      if(destroyed)return {x:0,hold:false};
      const state=Tasks.state()||{},a=profile.actionLabel;
      if(a){const text=typeof a==='function'?a(state):Array.isArray(a)?a[Math.min(state.k||0,a.length-1)]:a;if(actionName.textContent!==text){actionName.textContent=text;action.setAttribute('aria-label','Hold to '+text.toLowerCase());}}
      Tasks.inp.mouseHold=false;Tasks.inp.mouse=true;
      feedback();return {x:0,hold:holds.size>0};
    }
    move(slider.value);sample();
    return {profile,sample,release,destroy(){release();destroyed=true;bindings.forEach(off=>off());root.replaceChildren();root.classList.remove('phone-task-deck');}};
  }
  return {create,getProfile,ids:()=>Object.keys(profiles)};
})();
if(typeof module!=='undefined')module.exports=PhoneTaskControls;
