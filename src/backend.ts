import {Hono} from 'hono';
import {serveStatic} from '@hono/bun';
import {db,one,all} from './db/index.ts';
import {session,setSession,clearSession,requireLogin,requireAdmin,allowedClass,subscribed} from './lib/security.ts';
import {parseCSV} from './lib/csv.ts';
import safetyRoutes from './routes/safety.ts';
import {enqueueFeeReminders,flushNotifications} from './services/notifier.ts';
const app=new Hono();
app.route('/',safetyRoutes);
const dateOK=(s:any):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T00:00:00Z'));
const codeOK=(s:any)=>typeof s==='string'&&/^[a-z0-9-]{2,32}$/.test(s);
const limits=new Map<string,{n:number;end:number}>();
app.use('*',async(c,next)=>{c.header('X-Content-Type-Options','nosniff');c.header('X-Frame-Options','DENY');c.header('Referrer-Policy','same-origin');if(c.req.path.startsWith('/api/'))c.header('Cache-Control','no-store');await next();});
app.get('/api/health',c=>c.json({ok:true,service:'SnapAttend',stack:['Bun','Hono','Mango','SQLite']}));
app.post('/api/auth/login',async c=>{
 const b=await c.req.json().catch(()=>({})) as any;
 const code=String(b.institution_code||'').toLowerCase(),classCode=String(b.class_code||'').toLowerCase(),role=String(b.role||''),password=String(b.password||'');
 if(!codeOK(code)||!['teacher','admin'].includes(role)||password.length<4||password.length>128)return c.json({error:'Invalid sign-in details'},400);
 const origin=c.req.header('origin');if(origin&&new URL(origin).host!==new URL(c.req.url).host)return c.json({error:'Origin mismatch'},403);
 const key=(c.req.header('x-real-ip')||'local').slice(0,70)+':'+code;
 const limit=limits.get(key);if(limit&&limit.n>=6&&limit.end>Date.now())return c.json({error:'Try again in 15 minutes'},429);
 const inst=one<any>('SELECT id,admin_hash FROM institutions WHERE code=?',code);
 const klass=inst&&role==='teacher'?one<any>('SELECT id,teacher_pin_hash FROM classes WHERE institution_id=? AND code=?',inst.id,classCode):null;
 const hashed=role==='admin'?inst?.admin_hash:klass?.teacher_pin_hash;
 if(!hashed||!await Bun.password.verify(password,hashed)){limits.set(key,{n:(limit&&limit.end>Date.now()?limit.n:0)+1,end:Date.now()+900000});return c.json({error:'Invalid sign-in details'},401);}
 limits.delete(key);setSession(c,{role:role as 'teacher'|'admin',institution_id:inst.id,class_id:klass?.id||null});return c.json({ok:true});
});
app.get('/api/auth/me',c=>{const s=session(c);return s?c.json({session:s}):c.json({error:'Not signed in'},401);});
app.post('/api/auth/logout',c=>{clearSession(c);return c.json({ok:true});});
app.use('/api/classes/*',requireLogin);
app.get('/api/classes',requireLogin,c=>{
 const s=session(c)!;
 const classes=s.role==='admin'?all('SELECT id,code,name FROM classes WHERE institution_id=? ORDER BY name',s.institution_id):
 all('SELECT id,code,name FROM classes WHERE institution_id=? AND id=? ORDER BY name',s.institution_id,s.class_id);
 return c.json({classes});
});
app.get('/api/classes/:id/roster',c=>{
 const id=(c.req.param('id')||'');if(!allowedClass(c,id))return c.json({error:'Forbidden'},403);
 return c.json({students:all('SELECT id,roll_no,name FROM students WHERE class_id=? ORDER BY roll_no,name',id)});
});
app.post('/api/classes/:id/import',requireAdmin,async c=>{
 const id=(c.req.param('id')||'');if(!allowedClass(c,id))return c.json({error:'Forbidden'},403);
 if(!(c.req.header('content-type')||'').includes('text/csv'))return c.json({error:'Use text/csv'},415);
 const raw=await c.req.text();if(raw.length>1024*1024)return c.json({error:'CSV too large'},413);
 let rows:string[][];try{rows=parseCSV(raw);}catch{return c.json({error:'Malformed CSV'},400);}
 if(rows.length<2||rows.length>1001)return c.json({error:'CSV must contain 1-1000 students'},400);
 const head=rows.shift()!.map(s=>s.trim().toLowerCase()),required=['roll_no','name'];if(required.some(h=>!head.includes(h)))return c.json({error:'CSV needs roll_no,name'},400);
 const idx=(name:string)=>head.indexOf(name);
 const recs=[] as any[];const seen=new Set<string>();
 for(const row of rows){const val=(name:string)=>String(row[idx(name)]||'').trim();
  const roll=val('roll_no'),name=val('name'),phone=val('parent_phone'),consent=val('parent_opt_in'),fee=val('fee_status')||'paid',due=val('fee_due_date')||null;
  if(!roll||roll.length>24||!name||name.length>120||seen.has(roll)||phone&&!/^\+?[1-9]\d{7,14}$/.test(phone)||!['','0','1','yes','no','true','false'].includes(consent.toLowerCase())||!['paid','pending'].includes(fee)||(due&&!dateOK(due)))return c.json({error:'Invalid, duplicate or unconsented CSV data'},400);
  seen.add(roll);recs.push({roll,name,phone:phone||null,opt:['1','yes','true'].includes(consent.toLowerCase())?1:0,fee,due});
 }
 db.transaction(()=>{const stmt=db.query(`INSERT INTO students(id,class_id,roll_no,name,parent_phone,parent_opt_in,fee_status,fee_due_date)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(class_id,roll_no) DO UPDATE SET
 name=excluded.name,parent_phone=excluded.parent_phone,parent_opt_in=excluded.parent_opt_in,
 fee_status=excluded.fee_status,fee_due_date=excluded.fee_due_date`);
 for(const r of recs)stmt.run(crypto.randomUUID(),id,r.roll,r.name,r.phone,r.opt,r.fee,r.due);})();
 return c.json({ok:true,imported:recs.length});
});
app.get('/api/classes/:id/attendance/:date',c=>{
 const id=(c.req.param('id')||''),date=c.req.param('date');if(!allowedClass(c,id))return c.json({error:'Forbidden'},403);
 if(!dateOK(date))return c.json({error:'Invalid date'},400);
 return c.json({records:all('SELECT student_id,status,parent_reply_status,emergency_flag FROM attendance_logs WHERE class_id=? AND date=?',id,date)});
});
app.post('/api/classes/:id/attendance',async c=>{
 const id=(c.req.param('id')||'');if(!allowedClass(c,id))return c.json({error:'Forbidden'},403);
 if(!subscribed(c))return c.json({error:'Subscription expired'},402);
 const b=await c.req.json().catch(()=>({})) as any;
 if(!dateOK(b.date)||typeof b.batch_id!=='string'||! /^[0-9a-f-]{36}$/i.test(b.batch_id)||!Array.isArray(b.absent_ids)||b.absent_ids.some((x:any)=>typeof x!=='string')||b.absent_ids.length>1000)return c.json({error:'Invalid attendance data'},400);
 const roster=all<any>('SELECT id,parent_opt_in,parent_phone FROM students WHERE class_id=?',id);
 const absent=new Set<string>(b.absent_ids);
 if(!roster.length||roster.length>1000||absent.size!==b.absent_ids.length||[...absent].some(x=>!roster.some(s=>s.id===x)))return c.json({error:'Roster mismatch'},409);
 const old=one<any>('SELECT class_id,date FROM attendance_batches WHERE id=?',b.batch_id);
 if(old)return old.class_id===id&&old.date===b.date?c.json({ok:true,already_synced:true}):c.json({error:'Batch ID conflict'},409);
 try{db.transaction(()=>{
  db.query('INSERT INTO attendance_batches(id,class_id,date) VALUES(?,?,?)').run(b.batch_id,id,b.date);
  const add=db.query('INSERT INTO attendance_logs(id,batch_id,student_id,class_id,date,status) VALUES(?,?,?,?,?,?)');
  const notify=db.query('INSERT OR IGNORE INTO notification_jobs(id,dedupe_key,kind,student_id,attendance_id) VALUES(?,?,?,?,?)');
  for(const s of roster){const a=crypto.randomUUID(),isAbsent=absent.has(s.id);add.run(a,b.batch_id,s.id,id,b.date,isAbsent?'absent':'present');
   if(isAbsent&&s.parent_opt_in&&s.parent_phone)notify.run(crypto.randomUUID(),'absence:'+a,'absence',s.id,a);
  }
 })();}catch{return c.json({error:'Attendance already submitted for this date'},409);}
 void flushNotifications();return c.json({ok:true,absent:absent.size,present:roster.length-absent.size});
});
app.get('/api/admin/summary',requireLogin,requireAdmin,c=>{
 const s=session(c)!;
 return c.json({
  emergencies:all(`SELECT a.id,a.date,s.name AS student_name,c.name AS class_name
   FROM attendance_logs a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id
   WHERE c.institution_id=? AND a.emergency_flag=1 AND a.acknowledged_at IS NULL ORDER BY a.date DESC LIMIT 100`,s.institution_id),
  summaries:all(`SELECT c.name,a.date,COUNT(*) AS total,SUM(a.status='absent') AS absent
   FROM attendance_logs a JOIN classes c ON c.id=a.class_id
   WHERE c.institution_id=? GROUP BY a.class_id,a.date ORDER BY a.date DESC LIMIT 30`,s.institution_id)
 });
});
app.post('/api/admin/emergencies/:id/acknowledge',requireLogin,requireAdmin,c=>{
 const s=session(c)!;db.query(`UPDATE attendance_logs SET acknowledged_at=datetime('now')
 WHERE id=? AND emergency_flag=1 AND class_id IN (SELECT id FROM classes WHERE institution_id=?)`).run((c.req.param('id')||''),s.institution_id);
 return c.json({ok:true});
});
app.post('/api/admin/fee-reminders',requireLogin,requireAdmin,c=>{const queued=enqueueFeeReminders();void flushNotifications();return c.json({ok:true,queued});});
app.post('/api/homework/classes/:id/homework',requireLogin,async c=>{
 const id=(c.req.param('id')||'');if(!allowedClass(c,id))return c.json({error:'Forbidden'},403);
 if(!subscribed(c))return c.json({error:'Subscription expired'},402);
 const data=await c.req.parseBody();const candidate=data.audio,date=String(data.date||'');
 const audio=typeof candidate === 'string' ? null : (candidate as File | undefined);
 if(!dateOK(date)||!audio||audio.size<100||audio.size>2*1024*1024||!audio.type.startsWith('audio/'))return c.json({error:'Invalid recording (max 2MB)'},400);
 const dir=`${process.env.DATA_DIR||'./data'}/uploads`;await Bun.$`mkdir -p ${dir}`.quiet();
 const key=crypto.randomUUID(),file=`${dir}/${key}.audio`;await Bun.write(file,audio);
 db.query('INSERT INTO homework_broadcasts(id,class_id,date,audio_path,mime_type) VALUES(?,?,?,?,?)').run(key,id,date,file,audio.type);
 return c.json({ok:true,id:key,broadcast:false});
});
app.use('/api/homework/*',requireLogin);
app.get('/api/homework/:id/audio',async c=>{
 const s=session(c)!,item=one<any>(`SELECT h.audio_path,h.mime_type,c.institution_id,h.class_id FROM homework_broadcasts h JOIN classes c ON c.id=h.class_id WHERE h.id=?`,(c.req.param('id')||''));
 if(!item||item.institution_id!==s.institution_id||(s.role==='teacher'&&s.class_id!==item.class_id))return c.json({error:'Not found'},404);
 const f=Bun.file(item.audio_path);if(!await f.exists())return c.json({error:'File missing'},404);
 return new Response(f,{headers:{'Content-Type':item.mime_type||'application/octet-stream','Cache-Control':'no-store'}});
});
app.get('/api/webhooks/whatsapp',c=>{
 const token=c.req.query('hub.verify_token'),challenge=c.req.query('hub.challenge');
 return token&&token===process.env.WHATSAPP_VERIFY_TOKEN&&process.env.WHATSAPP_VERIFY_TOKEN?c.text(challenge||''):c.text('Forbidden',403);
});
app.post('/api/webhooks/whatsapp',async c=>{
 const secret=process.env.WHATSAPP_APP_SECRET;
 if(!secret)return c.json({error:'Webhook not configured'},503);
 const body=await c.req.text(),sig=c.req.header('x-hub-signature-256')||'';
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(body)));
 const expected='sha256='+Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
 // Constant-time comparison without a Node.js runtime or external crypto library.
 let diff=sig.length^expected.length;
 for(let i=0;i<expected.length;i++)diff|=(sig.charCodeAt(i)||0)^expected.charCodeAt(i);
 if(diff!==0)return c.json({error:'Bad signature'},403);
 const payload=JSON.parse(body);
 for(const entry of payload.entry||[])for(const change of entry.changes||[])for(const msg of change.value?.messages||[]){
  const choice=msg.interactive?.button_reply?.id,from=msg.from,messageId=msg.id;
  if(!from||!messageId||!['sick','leave','emergency'].includes(choice))continue;
  const student=one<any>(`SELECT a.id FROM attendance_logs a JOIN students s ON s.id=a.student_id
   WHERE a.status='absent' AND s.parent_opt_in=1 AND replace(s.parent_phone,'+','')=?
   ORDER BY a.date DESC LIMIT 1`,String(from));
  if(!student)continue;
  try{db.transaction(()=>{
   db.query('INSERT INTO webhook_events(id) VALUES(?)').run(messageId);
   db.query('UPDATE attendance_logs SET parent_reply_status=?,emergency_flag=? WHERE id=?').run(choice,choice==='emergency'?1:0,student.id);
  })();}catch{/* Duplicate webhook delivery, ignore */}
 }
 return c.json({ok:true});
});
app.get('/',serveStatic({path:'./public/index.html'}));
app.get('/app.js',serveStatic({path:'./public/app.js'}));
app.get('/student.html',serveStatic({path:'./public/student.html'}));
app.get('/student.js',serveStatic({path:'./public/student.js'}));
app.get('/student.css',serveStatic({path:'./public/student.css'}));
app.get('/styles.css',serveStatic({path:'./public/styles.css'}));
app.get('/mango.js',serveStatic({path:'./public/mango.js'}));
app.get('/sw.js',serveStatic({path:'./public/sw.js'}));
app.get('/manifest.json',serveStatic({path:'./public/manifest.json'}));
app.get('/icons/*',serveStatic({root:'./public'}));
app.notFound(c=>c.json({error:'Not found'},404));
app.onError((e,c)=>{console.error('API error',e);return c.json({error:'Server error'},500);});
export default app;