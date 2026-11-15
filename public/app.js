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
var academySearchTimer=null;
function setMode(mode){
 var signingIn=mode==='signin';
 $('login-form').hidden=!signingIn;$('register-form').hidden=signingIn;
 $('tab-signin').classList.toggle('is-active',signingIn);
 $('tab-register').classList.toggle('is-active',!signingIn);
 $('tab-signin').setAttribute('aria-selected',signingIn?'true':'false');
 $('tab-register').setAttribute('aria-selected',signingIn?'false':'true');
}
$('tab-signin').addEventListener('click',function(){setMode('signin');});
$('tab-register').addEventListener('click',function(){setMode('register');});
function setRole(role){
 $('role').value=role;
 var isFamily=role==='family';
 $('family-role-wrap').hidden=!isFamily;
 $('class-wrap').hidden=role==='admin';
 $('identity-wrap').hidden=!isFamily;
 $('class').required=role!=='admin';
 $('roll').required=isFamily;
 document.querySelectorAll('.role-pill').forEach(function(pill){
  var active=pill.getAttribute('data-role')===role;
  pill.classList.toggle('is-selected',active);
  pill.setAttribute('aria-pressed',active?'true':'false');
 });
}
document.querySelectorAll('.role-pill').forEach(function(pill){
 pill.addEventListener('click',function(){setRole(pill.getAttribute('data-role'));});
});
async function loadAcademies(search){
 var previous=$('school').value;
 try{
  var data=await api('/api/academies'+(search?'?search='+encodeURIComponent(search):''));
  var sel=$('school');sel.textContent='';
  var placeholder=m('option','','Select an academy');placeholder.value='';sel.appendChild(placeholder);
  data.academies.forEach(function(academy){
   var option=m('option','',academy.name+' · '+academy.code);option.value=academy.code;sel.appendChild(option);
  });
  if(previous&&data.academies.some(function(item){return item.code===previous;}))sel.value=previous;
  if(!data.academies.length){var none=m('option','','No academy found');none.disabled=true;sel.appendChild(none);}
 }catch(e){
  $('error').textContent='Cannot load academies. If this is a UI preview, select a Demo below.';
 }
}
$('academy-search').addEventListener('input',function(){
 clearTimeout(academySearchTimer);
 var search=$('academy-search').value.trim();
 academySearchTimer=setTimeout(function(){loadAcademies(search);},220);
});
$('reg-name').addEventListener('blur',function(){
 if($('reg-code').value)return;
 $('reg-code').value=$('reg-name').value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32);
});
$('login-form').addEventListener('submit',async function(e){
 e.preventDefault();$('error').textContent='';
 var role=$('role').value==='family'?$('family-role').value:$('role').value;
 var pin=$('password').value;
 if(!/^[0-9]{4}$/.test(pin)){$('error').textContent='Enter your 4-digit PIN';return;}
 try{
  await api('/api/auth/login',{method:'POST',body:{
   institution_code:$('school').value,class_code:role==='admin'?'':$('class').value.trim(),
   roll_no:role==='student'||role==='parent'?$('roll').value.trim():'',
   role:role,pin:pin
  }});
  $('password').value='';
  await init();
 }catch(err){$('error').textContent=err.message;}
});
$('register-form').addEventListener('submit',async function(e){
 e.preventDefault();$('reg-error').textContent='';
 var pin=$('reg-pin').value,confirm=$('reg-confirm').value;
 if(!/^[0-9]{4}$/.test(pin)||pin!==confirm){$('reg-error').textContent='Create matching 4-digit Admin PINs';return;}
 try{
  var result=await api('/api/academies/register',{method:'POST',body:{
   name:$('reg-name').value.trim(),kind:$('reg-kind').value,
   code:$('reg-code').value.trim().toLowerCase(),admin_pin:pin,confirm_pin:confirm,
   public_listing:$('reg-listing').checked
  }});
  $('reg-pin').value='';$('reg-confirm').value='';
  notify('Academy created. Set up a class and teacher PIN.');
  await init();
 }catch(err){$('reg-error').textContent=err.message;}
});
setRole('teacher');
$('logout').addEventListener('click',async function(){if(!state.demo){try{await api('/api/auth/logout',{method:'POST'});}catch(e){}}state.demo=false;state.session=null;document.body.classList.remove('workspace');$('issued-student-token').value='';$('issued-token-wrap').hidden=true;$('desk').hidden=true;$('login').hidden=false;$('logout').hidden=true;});
async function init(){
 var me=await api('/api/auth/me');
 state.session=me.session;state.classes=[];
 var role=state.session.role;
 if(role==='admin'||role==='teacher'){
  state.classes=(await api('/api/classes')).classes;
 }
 $('login').hidden=true;$('desk').hidden=false;$('logout').hidden=false;
 $('teacher').hidden=role!=='teacher';$('admin').hidden=role!=='admin';
 $('family').hidden=role!=='student'&&role!=='parent';
 document.body.classList.add('workspace');
 $('today').textContent=new Date().toLocaleDateString();$('date').value=today();
 if(role==='teacher'){
  state.classId=state.classes[0]&&state.classes[0].id;
  $('title').textContent=state.classes[0]?state.classes[0].name:'No class assigned';
  await loadRoster();
 }else if(role==='admin'){
  $('title').textContent=(me.academy&&me.academy.name||'Academy')+' · Workspace';
  var sel=$('import-class');sel.textContent='';
  state.classes.forEach(function(item){var option=m('option','',item.name);option.value=item.id;sel.appendChild(option);});
  await admin();await refreshStudentChoices();
 }else {
  $('title').textContent=role==='parent'?'Guardian workspace':'Student workspace';
  await loadFamily();
 }
 if(role==='admin'||role==='teacher')await sync();
}
async function loadFamily(){
 var area=$('family-records');area.textContent='';
 if(state.demo){
  $('family-title').textContent='Example child · Attendance';
  $('family-school').textContent='Demo Academy · Grade 8A';
  area.appendChild(m('p','','Demo only — no student information is retrieved or saved.'));
  return;
 }
 try{
  var result=await api('/api/account/overview');
  $('family-title').textContent=result.student.name+' · Attendance';
  $('family-school').textContent=result.student.academy_name+' · '+result.student.class_name+' · Roll '+result.student.roll_no;
  if(!result.attendance.length)area.appendChild(m('p','','No attendance records yet.'));
  result.attendance.forEach(function(item){
   var line=m('p','',item.date+' · '+(item.status==='absent'?'Absent':'Present'));
   area.appendChild(line);
  });
 }catch(err){area.appendChild(m('p','','Could not load your attendance: '+err.message));}
}
async function loadRoster(){if(!state.classId)return;var key='sa-roster:'+state.classId;try{state.roster=(await api('/api/classes/'+state.classId+'/roster')).students;store(key,state.roster);}catch(e){state.roster=read(key,[]);notify('Offline roster loaded');}state.absent={};state.submitted=false;try{var records=(await api('/api/classes/'+state.classId+'/attendance/'+$('date').value)).records;if(records.length){state.submitted=true;records.forEach(function(x){if(x.status==='absent')state.absent[x.student_id]=true;});}}catch(e){}draw();}
function draw(){var root=$('roster');root.textContent='';state.roster.forEach(function(s){var r=m('div','student'),avatar=m('span','avatar',s.name.charAt(0)),info=m('div','student-info'),title=m('strong','',s.name),roll=m('small','','Roll '+s.roll_no),button=m('button',state.absent[s.id]?'absent':'',state.absent[s.id]?'Absent':'Present');info.appendChild(title);info.appendChild(roll);button.disabled=state.submitted;button.setAttribute('aria-pressed',state.absent[s.id]?'true':'false');button.addEventListener('click',function(){if(state.absent[s.id])delete state.absent[s.id];else state.absent[s.id]=true;draw();});r.appendChild(avatar);r.appendChild(info);r.appendChild(button);root.appendChild(r);});if(!state.roster.length)root.appendChild(m('p','','No students. Ask admin to import a CSV.'));var a=Object.keys(state.absent).length;$('total').textContent=state.roster.length;$('present').textContent=state.roster.length-a;$('absent').textContent=a;$('submit').disabled=state.demo||state.submitted||!state.roster.length;$('submit').textContent=state.demo?'Preview only · saving disabled':state.submitted?'Submitted':'Submit attendance';$('queue').textContent=read(queueKey,[]).length+' submission(s) awaiting sync';}
$('date').addEventListener('change',loadRoster);
$('submit').addEventListener('click',async function(){if(state.demo)return notify('Demo only: attendance has not been saved');if(state.submitted||!state.classId)return;var q=read(queueKey,[]);q.push({class_id:state.classId,date:$('date').value,batch_id:crypto.randomUUID(),absent_ids:Object.keys(state.absent)});store(queueKey,q);state.submitted=true;draw();notify('Attendance saved on this device');await sync();});
async function sync(){if(state.syncing||!state.session||!navigator.onLine||state.demo)return;state.syncing=true;var q=read(queueKey,[]),keep=[];for(var i=0;i<q.length;i++){try{await api('/api/classes/'+q[i].class_id+'/attendance',{method:'POST',body:q[i]});}catch(e){keep.push(q[i]);notify('Sync pending: '+e.message);}}store(queueKey,keep);state.syncing=false;if(state.session.role==='teacher')draw();}
async function admin(){if(state.session?.role!=='admin')return;if(state.demo){$('emergency').hidden=true;$('alerts').textContent='No live alerts in this UI preview';$('recent').textContent='Demo only. Connect the persistent Bun + SQLite server for actual attendance.';$('safety-events').textContent='No real GPS events. The student portal is also a local-only demo.';return;}try{var data=await api('/api/admin/summary'),a=$('alerts'),r=$('recent');$('emergency').hidden=!data.emergencies.length;a.textContent='';r.textContent='';data.emergencies.forEach(function(x){var line=m('div','alert',x.student_name+' — '+x.class_name+' ('+x.date+')'),btn=m('button','','Acknowledge');btn.addEventListener('click',async function(){await api('/api/admin/emergencies/'+x.id+'/acknowledge',{method:'POST'});await admin();});line.appendChild(btn);a.appendChild(line);});if(!data.emergencies.length)a.appendChild(m('p','','No emergency replies'));data.summaries.forEach(function(x){r.appendChild(m('p','',x.name+' · '+x.date+' · '+x.absent+' absent / '+x.total+' total'));});}catch(e){notify('Dashboard: '+e.message);}await loadSafetyAdmin();}
$('upload').addEventListener('click',async function(){var f=$('csv').files[0],id=$('import-class').value;if(!f||!id)return notify('Choose CSV and class');try{var t=await f.text();var r=await api('/api/classes/'+id+'/import',{method:'POST',headers:{'content-type':'text/csv'},body:t});$('csv-status').textContent=r.imported+' students imported';await refreshStudentChoices();}catch(e){$('csv-status').textContent=e.message;}});
$('fees').addEventListener('click',async function(){try{var r=await api('/api/admin/fee-reminders',{method:'POST'});$('fee-status').textContent=r.queued+' reminders queued in mock mode';}catch(e){notify(e.message);}});
$('create-class').addEventListener('click',async function(){
 if(state.demo)return notify('Demo only — cannot create a class here');
 var name=$('new-class-name').value.trim(),code=$('new-class-code').value.trim(),pin=$('new-teacher-pin').value.trim();
 if(!name||!/^[a-z0-9-]{3,32}$/.test(code)||!/^[0-9]{4}$/.test(pin)){
  $('class-create-status').textContent='Enter class name, lowercase class code and 4-digit PIN';return;
 }
 try{
  var response=await api('/api/admin/classes',{method:'POST',body:{name:name,code:code,teacher_pin:pin}});
  $('new-teacher-pin').value='';$('new-class-name').value='';$('new-class-code').value='';
  $('class-create-status').textContent='Class '+response.class.name+' created. Share its code and PIN privately with the assigned teacher.';
  state.classes=(await api('/api/classes')).classes;
  var sel=$('import-class');sel.textContent='';
  state.classes.forEach(function(klass){var opt=m('option','',klass.name);opt.value=klass.id;sel.appendChild(opt);});
  sel.value=response.class.id;await refreshStudentChoices();
 }catch(err){$('class-create-status').textContent=err.message;}
});
$('set-child-pins').addEventListener('click',async function(){
 if(state.demo)return notify('Demo only — no real PINs can be issued');
 var id=$('safety-student').value;
 if(!id)return notify('Select a student first');
 var studentPin=$('child-student-pin').value.trim(),parentPin=$('child-parent-pin').value.trim();
 if((!studentPin&&!parentPin)||(studentPin&&!/^[0-9]{4}$/.test(studentPin))||
  (parentPin&&!/^[0-9]{4}$/.test(parentPin))||(studentPin&&studentPin===parentPin)){
  $('child-pin-status').textContent='Enter valid, different 4-digit PINs for the chosen identities';return;
 }
 try{
  var response=await api('/api/admin/students/'+encodeURIComponent(id)+'/pins',{
   method:'POST',body:{student_pin:studentPin,parent_pin:parentPin}
  });
  $('child-student-pin').value='';$('child-parent-pin').value='';
  $('child-pin-status').textContent='PIN(s) securely hashed. Share separately and privately with student/guardian.';
 }catch(err){$('child-pin-status').textContent=err.message;}
});

async function startRecord(){if(state.recording)return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return notify('Audio recording not supported on this device');try{var stream=await navigator.mediaDevices.getUserMedia({audio:true});var rec=new MediaRecorder(stream),parts=[];state.recording=rec;rec.ondataavailable=function(e){if(e.data.size)parts.push(e.data);};rec.onstop=async function(){stream.getTracks().forEach(function(t){t.stop();});state.recording=null;var body=new FormData();body.append('date',$('date').value);body.append('audio',new Blob(parts,{type:rec.mimeType||'audio/webm'}),'homework.audio');try{await api('/api/homework/classes/'+state.classId+'/homework',{method:'POST',body:body});$('record-status').textContent='Saved privately; parent sending disabled';}catch(e){notify(e.message);}};rec.start();$('record-status').textContent='Recording… release to save';setTimeout(stopRecord,10000);}catch(e){notify('Allow microphone permission in browser settings');}}
function stopRecord(){var rec=state.recording;if(rec&&rec.state==='recording')rec.stop();}
var btn=$('record');if(window.PointerEvent){btn.addEventListener('pointerdown',startRecord);btn.addEventListener('pointerup',stopRecord);btn.addEventListener('pointercancel',stopRecord);}else{btn.addEventListener('touchstart',startRecord);btn.addEventListener('touchend',stopRecord);btn.addEventListener('mousedown',startRecord);window.addEventListener('mouseup',stopRecord);}

async function refreshStudentChoices(){
 var id=$('import-class').value,sel=$('safety-student');
 sel.textContent='';
 if(!id||state.demo)return;
 try {
  var result=await api('/api/classes/'+id+'/roster');
  result.students.forEach(function(student){
   var option=m('option','',student.name+' · '+student.roll_no);
   option.value=student.id;
   sel.appendChild(option);
  });
 }catch(e){$('safety-admin-status').textContent='Unable to load student list: '+e.message;}
}
async function loadSafetyAdmin(){
 if(state.demo)return;
 try{
  var result=await api('/api/admin/safety-events'),container=$('safety-events');
  container.textContent='';
  if(!result.events.length){container.appendChild(m('p','','No reported location events'));}
  result.events.forEach(function(item){
   var row=m('div','alert');
   row.appendChild(m('strong','',item.student_name+' · '+item.kind+' · '+item.class_name));
   row.appendChild(m('small','',new Date(item.created_at).toLocaleString()+' · accuracy ±'+Math.round(item.accuracy_m)+'m · '+item.notification_status));
   var link=m('a','','View reported position on Google Maps');link.href=item.map_url;link.target='_blank';link.rel='noopener noreferrer';row.appendChild(link);
   container.appendChild(row);
  });
 }catch(e){$('safety-events').textContent='Safety events unavailable: '+e.message;}
}
$('import-class').addEventListener('change',refreshStudentChoices);
$('issue-student-token').addEventListener('click',async function(){
 if(state.demo)return notify('Demo cannot issue real access codes');
 var id=$('safety-student').value;
 if(!id)return notify('Choose a student');
 $('issued-student-token').value='';$('issued-token-wrap').hidden=true;
 try{
  var result=await api('/api/admin/students/'+encodeURIComponent(id)+'/safety-access',{method:'POST'});
  $('issued-student-token').value=result.access_token;
  $('issued-token-wrap').hidden=false;
  $('safety-admin-status').textContent='Private code expires '+new Date(result.expires_at).toLocaleString()+'. Give it only to the student; never include in public URLs.';
 }catch(e){$('safety-admin-status').textContent=e.message;}
});
$('request-student-location').addEventListener('click',async function(){
 if(state.demo)return notify('Demo cannot send actual requests');
 var id=$('safety-student').value;
 if(!id)return notify('Choose a student');
 try{
  var result=await api('/api/admin/students/'+encodeURIComponent(id)+'/location-request',{method:'POST'});
  $('safety-admin-status').textContent='One-time request created. Student must open their portal and approve sharing. Push/WhatsApp notifications are NOT configured.';
 }catch(e){$('safety-admin-status').textContent=e.message;}
});

var prompt=null,standalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;var ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function banner(isIos){if(standalone||localStorage.getItem('sa-install-dismissed'))return;$('install-banner').hidden=false;$('install-label').textContent=isIos?'Add to Home Screen':'Install SnapAttend Tool';$('install-hint').textContent=isIos?'Safari: tap Share → Add to Home Screen':'Quick access, even offline';$('install-btn').hidden=isIos;}
if(ios&&!standalone)banner(true);window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();prompt=e;banner(false);});window.addEventListener('appinstalled',function(){$('install-banner').hidden=true;});
$('install-btn').addEventListener('click',async function(){if(prompt){prompt.prompt();await prompt.userChoice;prompt=null;$('install-banner').hidden=true;}});
$('dismiss').addEventListener('click',function(){$('install-banner').hidden=true;localStorage.setItem('sa-install-dismissed','1');});
if('serviceWorker'in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});
function demoView(role){
 state.demo=true;
 $('issue-student-token').disabled=true;$('request-student-location').disabled=true;
 $('set-child-pins').disabled=true;$('create-class').disabled=true;
 state.session={role:role,institution_id:'fictional-demo',class_id:'demo-class',student_id:role==='parent'||role==='student'?'demo-1':null};
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
 $('family').hidden=role!=='student'&&role!=='parent';
 document.body.classList.add('workspace');
 $('today').textContent=new Date().toLocaleDateString();$('date').value=today();
 $('title').textContent=role==='teacher'?'Grade 8A — UI demo':role==='admin'?'Academy Workspace — demo':'Family Workspace — demo';
 if(role==='teacher')draw();
 else if(role==='admin'){$('import-class').textContent='';$('upload').disabled=true;$('fees').disabled=true;admin();}
 else loadFamily();
 refreshNetwork();notify('UI preview only — nothing is saved or sent');
}
$('demo-teacher').addEventListener('click',function(){demoView('teacher');});
$('demo-admin').addEventListener('click',function(){demoView('admin');});
$('demo-family').addEventListener('click',function(){demoView('parent');});
api('/api/health').then(function(health){
 if(health.mode==='ui-preview'){
  $('preview-note').hidden=false;
  $('demo-controls').hidden=false;
  var sel=$('school');
  var option=m('option','','SnapAttend Demo Academy (preview only)');option.value='demo-school';
  sel.appendChild(option);
  $('reg-error').textContent='Preview mode: real registration is disabled until the Bun + SQLite backend is deployed.';
 }else{loadAcademies('');}
}).catch(function(){loadAcademies('');});

refreshNetwork();api('/api/auth/me').then(init).catch(function(){});setInterval(function(){if(state.session){sync();if(state.session.role==='admin'&&navigator.onLine)admin();}},10000);
})();