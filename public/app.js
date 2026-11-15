(function(){'use strict';
var $=function(id){return document.getElementById(id);};
if(!window.mango||!window.mango.j){$('error').textContent='Mango Framework did not load. Reload when online.';return;}
// Mango's native DOM runtime is intentionally used without JSX, Parcel, React or a virtual DOM.
function m(tag,klass,text){var e=window.mango.j(tag,null,text===undefined?[]:[String(text)]);if(klass)e.className=klass;return e;}
var state={session:null,classes:[],classId:null,roster:[],absent:{},submitted:false,recording:null,prompt:null,syncing:false,demo:false};
var queueKey='sa-queue-v1';
function notify(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(function(){$('toast').hidden=true;},3500);}
function read(k,defaultValue){try{return JSON.parse(localStorage.getItem(k))||defaultValue;}catch(e){return defaultValue;}}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){notify('Storage full; please sync attendance');}}
function today(){var d=new Date(),a=function(n){return String(n).padStart(2,'0');};return d.getFullYear()+'-'+a(d.getMonth()+1)+'-'+a(d.getDate());}
async function api(path,opt){opt=opt||{};opt.credentials='same-origin';if(opt.body&&typeof opt.body!=='string'&&!(opt.body instanceof FormData)){opt.headers={'content-type':'application/json'};opt.body=JSON.stringify(opt.body);}
var r=await fetch(path,opt),j=await r.json().catch(function(){return {};});if(!r.ok)throw Error(j.error||'Request failed');return j;}
function refreshNetwork(){$('net').textContent=state.demo?'UI preview':navigator.onLine?'Online':'Offline';if(navigator.onLine&&!state.demo)sync();}
window.addEventListener('online',refreshNetwork);window.addEventListener('offline',refreshNetwork);
$('role').addEventListener('change',function(){$('class-wrap').hidden=$('role').value!=='teacher';});
$('login-form').addEventListener('submit',async function(e){e.preventDefault();$('error').textContent='';try{await api('/api/auth/login',{method:'POST',body:{institution_code:$('school').value.trim(),class_code:$('class').value.trim(),role:$('role').value,password:$('password').value}});$('password').value='';await init();}catch(err){$('error').textContent=err.message;}});
$('logout').addEventListener('click',async function(){if(!state.demo){try{await api('/api/auth/logout',{method:'POST'});}catch(e){}}state.demo=false;state.session=null;$('desk').hidden=true;$('login').hidden=false;$('logout').hidden=true;});
async function init(){var me=await api('/api/auth/me');state.session=me.session;var result=await api('/api/classes');state.classes=result.classes;$('login').hidden=true;$('desk').hidden=false;$('logout').hidden=false;$('teacher').hidden=state.session.role!=='teacher';$('admin').hidden=state.session.role!=='admin';$('today').textContent=new Date().toLocaleDateString();$('date').value=today();
if(state.session.role==='teacher'){state.classId=state.classes[0]&&state.classes[0].id;$('title').textContent=state.classes[0]?.name||'No class assigned';await loadRoster();}else{$('title').textContent='Safety & operations';var sel=$('import-class');sel.textContent='';state.classes.forEach(function(c){var o=m('option','',c.name);o.value=c.id;sel.appendChild(o);});await admin();}await sync();}
async function loadRoster(){if(!state.classId)return;var key='sa-roster:'+state.classId;try{state.roster=(await api('/api/classes/'+state.classId+'/roster')).students;store(key,state.roster);}catch(e){state.roster=read(key,[]);notify('Offline roster loaded');}state.absent={};state.submitted=false;try{var records=(await api('/api/classes/'+state.classId+'/attendance/'+$('date').value)).records;if(records.length){state.submitted=true;records.forEach(function(x){if(x.status==='absent')state.absent[x.student_id]=true;});}}catch(e){}draw();}
function draw(){var root=$('roster');root.textContent='';state.roster.forEach(function(s){var r=m('div','student'),avatar=m('span','avatar',s.name.charAt(0)),info=m('div','student-info'),title=m('strong','',s.name),roll=m('small','','Roll '+s.roll_no),button=m('button',state.absent[s.id]?'absent':'',state.absent[s.id]?'Absent':'Present');info.appendChild(title);info.appendChild(roll);button.disabled=state.submitted;button.setAttribute('aria-pressed',state.absent[s.id]?'true':'false');button.addEventListener('click',function(){if(state.absent[s.id])delete state.absent[s.id];else state.absent[s.id]=true;draw();});r.appendChild(avatar);r.appendChild(info);r.appendChild(button);root.appendChild(r);});if(!state.roster.length)root.appendChild(m('p','','No students. Ask admin to import a CSV.'));var a=Object.keys(state.absent).length;$('total').textContent=state.roster.length;$('present').textContent=state.roster.length-a;$('absent').textContent=a;$('submit').disabled=state.demo||state.submitted||!state.roster.length;$('submit').textContent=state.demo?'Preview only · saving disabled':state.submitted?'Submitted':'Submit attendance';$('queue').textContent=read(queueKey,[]).length+' submission(s) awaiting sync';}
$('date').addEventListener('change',loadRoster);
$('submit').addEventListener('click',async function(){if(state.demo)return notify('Demo only: attendance has not been saved');if(state.submitted||!state.classId)return;var q=read(queueKey,[]);q.push({class_id:state.classId,date:$('date').value,batch_id:crypto.randomUUID(),absent_ids:Object.keys(state.absent)});store(queueKey,q);state.submitted=true;draw();notify('Attendance saved on this device');await sync();});
async function sync(){if(state.syncing||!state.session||!navigator.onLine)return;state.syncing=true;var q=read(queueKey,[]),keep=[];for(var i=0;i<q.length;i++){try{await api('/api/classes/'+q[i].class_id+'/attendance',{method:'POST',body:q[i]});}catch(e){keep.push(q[i]);notify('Sync pending: '+e.message);}}store(queueKey,keep);state.syncing=false;if(state.session.role==='teacher')draw();}
async function admin(){if(state.session?.role!=='admin')return;if(state.demo){$('emergency').hidden=true;$('alerts').textContent='No live alerts in this UI preview';$('recent').textContent='Demo only. Connect the persistent Bun + SQLite server for actual attendance.';return;}try{var data=await api('/api/admin/summary'),a=$('alerts'),r=$('recent');$('emergency').hidden=!data.emergencies.length;a.textContent='';r.textContent='';data.emergencies.forEach(function(x){var line=m('div','alert',x.student_name+' — '+x.class_name+' ('+x.date+')'),btn=m('button','','Acknowledge');btn.addEventListener('click',async function(){await api('/api/admin/emergencies/'+x.id+'/acknowledge',{method:'POST'});await admin();});line.appendChild(btn);a.appendChild(line);});if(!data.emergencies.length)a.appendChild(m('p','','No emergency replies'));data.summaries.forEach(function(x){r.appendChild(m('p','',x.name+' · '+x.date+' · '+x.absent+' absent / '+x.total+' total'));});}catch(e){notify('Dashboard: '+e.message);}}
$('upload').addEventListener('click',async function(){var f=$('csv').files[0],id=$('import-class').value;if(!f||!id)return notify('Choose CSV and class');try{var t=await f.text();var r=await api('/api/classes/'+id+'/import',{method:'POST',headers:{'content-type':'text/csv'},body:t});$('csv-status').textContent=r.imported+' students imported';}catch(e){$('csv-status').textContent=e.message;}});
$('fees').addEventListener('click',async function(){try{var r=await api('/api/admin/fee-reminders',{method:'POST'});$('fee-status').textContent=r.queued+' reminders queued in mock mode';}catch(e){notify(e.message);}});
async function startRecord(){if(state.recording)return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return notify('Audio recording not supported on this device');try{var stream=await navigator.mediaDevices.getUserMedia({audio:true});var rec=new MediaRecorder(stream),parts=[];state.recording=rec;rec.ondataavailable=function(e){if(e.data.size)parts.push(e.data);};rec.onstop=async function(){stream.getTracks().forEach(function(t){t.stop();});state.recording=null;var body=new FormData();body.append('date',$('date').value);body.append('audio',new Blob(parts,{type:rec.mimeType||'audio/webm'}),'homework.audio');try{await api('/api/homework/classes/'+state.classId+'/homework',{method:'POST',body:body});$('record-status').textContent='Saved privately; parent sending disabled';}catch(e){notify(e.message);}};rec.start();$('record-status').textContent='Recording… release to save';setTimeout(stopRecord,10000);}catch(e){notify('Allow microphone permission in browser settings');}}
function stopRecord(){var rec=state.recording;if(rec&&rec.state==='recording')rec.stop();}
var btn=$('record');if(window.PointerEvent){btn.addEventListener('pointerdown',startRecord);btn.addEventListener('pointerup',stopRecord);btn.addEventListener('pointercancel',stopRecord);}else{btn.addEventListener('touchstart',startRecord);btn.addEventListener('touchend',stopRecord);btn.addEventListener('mousedown',startRecord);window.addEventListener('mouseup',stopRecord);}
var prompt=null,standalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;var ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function banner(isIos){if(standalone||localStorage.getItem('sa-install-dismissed'))return;$('install-banner').hidden=false;$('install-label').textContent=isIos?'Add to Home Screen':'Install SnapAttend App';$('install-hint').textContent=isIos?'Safari: tap Share → Add to Home Screen':'Quick access, even offline';$('install-btn').hidden=isIos;}
if(ios&&!standalone)banner(true);window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();prompt=e;banner(false);});window.addEventListener('appinstalled',function(){$('install-banner').hidden=true;});
$('install-btn').addEventListener('click',async function(){if(prompt){prompt.prompt();await prompt.userChoice;prompt=null;$('install-banner').hidden=true;}});
$('dismiss').addEventListener('click',function(){$('install-banner').hidden=true;localStorage.setItem('sa-install-dismissed','1');});
if('serviceWorker'in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});
function demoView(role){
 state.demo=true;
 state.session={role:role,institution_id:'fictional-demo',class_id:role==='teacher'?'demo-class':null};
 state.classes=[{id:'demo-class',code:'grade-8a',name:'Grade 8A (demo)'}];
 state.classId='demo-class';state.absent={};state.submitted=false;
 state.roster=[
 {id:'demo-1',roll_no:'01',name:'Alex Perera'},
 {id:'demo-2',roll_no:'02',name:'Sam Fernando'},
 {id:'demo-3',roll_no:'03',name:'Maya Silva'},
 {id:'demo-4',roll_no:'04',name:'Noah Kumar'},
 {id:'demo-5',roll_no:'05',name:'Nila Jayasinghe'}
 ];
 $('login').hidden=true;$('desk').hidden=false;$('logout').hidden=false;
 $('teacher').hidden=role!=='teacher';$('admin').hidden=role!=='admin';
 $('today').textContent=new Date().toLocaleDateString();$('date').value=today();
 $('title').textContent=role==='teacher'?'Grade 8A — UI demo':'Safety & operations — UI demo';
 if(role==='teacher')draw();else{$('import-class').textContent='';$('upload').disabled=true;$('fees').disabled=true;admin();}
 refreshNetwork();notify('UI demo only — nothing is saved or sent');
}
$('demo-teacher').addEventListener('click',function(){demoView('teacher');});
$('demo-admin').addEventListener('click',function(){demoView('admin');});
api('/api/health').then(function(health){
 if(health.mode==='ui-preview'){
   $('preview-note').hidden=false;
   $('demo-controls').hidden=false;
 }
}).catch(function(){});

refreshNetwork();api('/api/auth/me').then(init).catch(function(){});setInterval(function(){if(state.session){sync();if(state.session.role==='admin'&&navigator.onLine)admin();}},10000);
})();