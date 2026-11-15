import {Hono, type Context} from 'hono';
import {db,one,all} from '../db/index.ts';
import {session,setSession,clearSession,requireLogin,requireAdmin, type Role} from '../lib/security.ts';

const router = new Hono();
const codeOK=(value:string)=>/^[a-z0-9-]{3,32}$/.test(value);
const pinOK=(value:string)=>/^\d{4}$/.test(value);
const nameOK=(value:string)=>value.length>=3&&value.length<=100;
const academyKinds=new Set(['academy','school','college','campus','tuition']);
const attempts=new Map<string,{count:number,expires:number}>();
const LIMIT=5,WINDOW=15*60*1000;

function noStore(c:Context){c.header('Cache-Control','no-store');}
function sameOrigin(c:Context):boolean{
 const origin=c.req.header('origin');
 try{return !origin||new URL(origin).origin===new URL(c.req.url).origin;}catch{return false;}
}
function guard(key:string):boolean{
 const now=Date.now();
 const row=attempts.get(key);
 if(row&&row.expires>now&&row.count>=LIMIT)return false;
 return true;
}
function fail(key:string){
 const now=Date.now();
 const row=attempts.get(key);
 if(attempts.size>4000) for(const [k,v] of attempts){if(v.expires<=now)attempts.delete(k);}
 if(attempts.size>5000)attempts.clear();
 attempts.set(key,{count:row&&row.expires>now?row.count+1:1,expires:now+WINDOW});
}
function client(c:Context):string{
 // Use only server-managed reverse proxy headers in production; never trust arbitrary Forwarded-IP from clients.
 return (c.req.header('x-real-ip')||'unknown').slice(0,80);
}
const invalid='Invalid academy, account or PIN';

router.get('/api/academies',c=>{
 noStore(c);
 const search=(c.req.query('search')||'').trim().toLowerCase().slice(0,70).replace(/[\\%_]/g,'');
 const match='%'+search+'%';
 const academies=all<{code:string;name:string;kind:string}>(
  "SELECT code,name,kind FROM institutions WHERE is_listed=1 AND (LOWER(name) LIKE ? OR code LIKE ?) ORDER BY name LIMIT 40",
  match,match
 );
 return c.json({academies});
});

router.post('/api/academies/register',async c=>{
 noStore(c);
 if(!sameOrigin(c))return c.json({error:'Origin mismatch'},403);
 // Require an explicit gate in production until anti-abuse and organization verification are deployed.
 if(process.env.APP_ENV==='production'&&process.env.REGISTRATION_ENABLED!=='true')
  return c.json({error:'Academy enrollment is temporarily unavailable; contact the service administrator'},503);
 const key='register:'+client(c);
 if(!guard(key))return c.json({error:'Too many registrations. Try again later'},429);
 const body=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body)return c.json({error:'Invalid registration'},400);
 const name=typeof body.name==='string'?body.name.trim():'';
 const code=typeof body.code==='string'?body.code.trim().toLowerCase():'';
 const kind=typeof body.kind==='string'?body.kind:'';
 const pin=typeof body.admin_pin==='string'?body.admin_pin:'';
 const confirm=typeof body.confirm_pin==='string'?body.confirm_pin:'';
 const listed=body.public_listing===true?1:0;
 if(!nameOK(name)||!codeOK(code)||!academyKinds.has(kind)||!pinOK(pin)||pin!==confirm)
  return c.json({error:'Enter a valid academy name, unique code and matching 4-digit administrator PIN'},400);
 const existing=one('SELECT 1 FROM institutions WHERE code=?',code);
 if(existing)return c.json({error:'Academy code is already registered. Choose another code'},409);
 const hash=await Bun.password.hash(pin,{algorithm:'argon2id'});
 const id=crypto.randomUUID();
 const until=new Date(Date.now()+15*86400000).toISOString().slice(0,10);
 try {
  db.query('INSERT INTO institutions(id,code,name,kind,is_listed,admin_hash,active_until) VALUES(?,?,?,?,?,?,?)')
    .run(id,code,name,kind,listed,hash,until);
 }catch{return c.json({error:'Academy code is already registered'},409);}
 fail(key); // moderate sign-up burst rate; success does not reset its allowance
 setSession(c,{role:'admin',institution_id:id,class_id:null,student_id:null});
 return c.json({ok:true,academy:{code,name,kind},role:'admin',active_until:until,trial_days:15},201);
});

router.post('/api/auth/login',async c=>{
 noStore(c);
 if(!sameOrigin(c))return c.json({error:'Origin mismatch'},403);
 const body=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body)return c.json({error:invalid},401);
 const academy=typeof body.institution_code==='string'?body.institution_code.trim().toLowerCase():'';
 const klass=typeof body.class_code==='string'?body.class_code.trim().toLowerCase():'';
 const roll=typeof body.roll_no==='string'?body.roll_no.trim():'';
 const role=body.role;
 const pin=typeof body.pin==='string'?body.pin:'';
 if(!codeOK(academy)||!['admin','teacher','student','parent'].includes(String(role))||!pinOK(pin)||
    (role!=='admin'&&!codeOK(klass))||(['student','parent'].includes(String(role))&&(!roll||roll.length>24)))
  return c.json({error:invalid},401);
 const key=['login',academy,role,klass,roll,client(c)].join(':').slice(0,250);
 if(!guard(key))return c.json({error:'Too many sign-in attempts. Wait 15 minutes'},429);
 const institution=one<{id:string;admin_hash:string;name:string}>(
  'SELECT id,admin_hash,name FROM institutions WHERE code=?',academy
 );
 let target: {class_id:string|null;student_id:string|null;hash:string|null} = {class_id:null,student_id:null,hash:null};
 if(institution){
  if(role==='admin')target.hash=institution.admin_hash;
  else{
   const klassRow=one<{id:string;teacher_pin_hash:string}>(
    'SELECT id,teacher_pin_hash FROM classes WHERE institution_id=? AND code=?',institution.id,klass
   );
   if(klassRow){
    target.class_id=klassRow.id;
    if(role==='teacher')target.hash=klassRow.teacher_pin_hash;
    else{
     const child=one<{id:string;student_pin_hash:string|null;parent_pin_hash:string|null;parent_opt_in:number;parent_phone:string|null}>(
      'SELECT s.id,p.student_pin_hash,p.parent_pin_hash,s.parent_opt_in,s.parent_phone FROM students s LEFT JOIN student_pins p ON p.student_id=s.id WHERE s.class_id=? AND s.roll_no=?',
      klassRow.id,roll
     );
     if(child){
      target.student_id=child.id;
      if(role==='student')target.hash=child.student_pin_hash;
      if(role==='parent'&&child.parent_opt_in===1&&child.parent_phone)target.hash=child.parent_pin_hash;
     }
    }
   }
  }
 }
 // Unknown accounts use a hash too, preventing a trivial user-enumeration timing signal.
 const dummy='$argon2id$v=19$m=65536,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$jt8SkRtu0HWVwaSKDZZYKNz6imivdHOVwxL0/XZkZWg';
 let verified=false;
 try{verified=await Bun.password.verify(pin,target.hash||dummy);}catch{verified=false;}
 if(!institution||!target.hash||!verified){
  fail(key);return c.json({error:invalid},401);
 }
 attempts.delete(key);
 const verifiedRole=role as Role;
 setSession(c,{role:verifiedRole,institution_id:institution.id,class_id:target.class_id,student_id:target.student_id});
 return c.json({ok:true,role:verifiedRole,academy:{code:academy,name:institution.name}});
});

router.get('/api/auth/me',c=>{
 noStore(c);
 const user=session(c);
 if(!user)return c.json({error:'Not signed in'},401);
 const institution=one<{name:string;code:string}>('SELECT name,code FROM institutions WHERE id=?',user.institution_id);
 return c.json({session:user,academy:institution});
});
router.post('/api/auth/logout',c=>{
 noStore(c);
 if(!sameOrigin(c))return c.json({error:'Origin mismatch'},403);
 clearSession(c);return c.json({ok:true});
});

// Admin provisions an individual class and its teacher PIN. Class codes disambiguate teachers.
router.post('/api/admin/classes',requireLogin,requireAdmin,async c=>{
 noStore(c);
 const user=session(c)!;
 const b=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
 const name=typeof b?.name==='string'?b.name.trim():'';
 const code=typeof b?.code==='string'?b.code.trim().toLowerCase():'';
 const pin=typeof b?.teacher_pin==='string'?b.teacher_pin:'';
 if(!nameOK(name)||!codeOK(code)||!pinOK(pin))return c.json({error:'Provide class name, class code and 4-digit teacher PIN'},400);
 const hash=await Bun.password.hash(pin,{algorithm:'argon2id'});
 const id=crypto.randomUUID();
 try{db.query('INSERT INTO classes(id,institution_id,code,name,teacher_pin_hash) VALUES(?,?,?,?,?)').run(id,user.institution_id,code,name,hash);}
 catch{return c.json({error:'This class code is already used in this academy'},409);}
 return c.json({ok:true,class:{id,code,name}},201);
});

// Student and parent get different hashes for the same child; never share a school-wide PIN.
router.post('/api/admin/students/:id/pins',requireLogin,requireAdmin,async c=>{
 noStore(c);
 const user=session(c)!;
 const id=c.req.param('id')||'';
 const student=one<{id:string;parent_opt_in:number;parent_phone:string|null}>(
  'SELECT s.id,s.parent_opt_in,s.parent_phone FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND c.institution_id=?',
  id,user.institution_id
 );
 if(!student)return c.json({error:'Student not found'},404);
 const b=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
 const studentPin=typeof b?.student_pin==='string'?b.student_pin:'';
 const parentPin=typeof b?.parent_pin==='string'?b.parent_pin:'';
 if((!studentPin&&!parentPin)||(studentPin&&!pinOK(studentPin))||(parentPin&&!pinOK(parentPin))||
    (studentPin&&parentPin&&studentPin===parentPin))
  return c.json({error:'Provide different 4-digit PINs for student and guardian'},400);
 if(parentPin&&(!student.parent_opt_in||!student.parent_phone))
  return c.json({error:'Guardian contact and documented consent required before issuing a parent PIN'},409);
 const studentHash=studentPin?await Bun.password.hash(studentPin,{algorithm:'argon2id'}):null;
 const parentHash=parentPin?await Bun.password.hash(parentPin,{algorithm:'argon2id'}):null;
 db.query(`INSERT INTO student_pins(student_id,student_pin_hash,parent_pin_hash) VALUES(?,?,?)
 ON CONFLICT(student_id) DO UPDATE SET
 student_pin_hash=COALESCE(excluded.student_pin_hash,student_pins.student_pin_hash),
 parent_pin_hash=COALESCE(excluded.parent_pin_hash,student_pins.parent_pin_hash),issued_at=datetime('now')`)
 .run(id,studentHash,parentHash);
 return c.json({ok:true,student_pin_set:!!studentPin,parent_pin_set:!!parentPin});
});

// Families can only view their own child's attendance. No class roster is exposed.
router.get('/api/account/overview',c=>{
 noStore(c);
 const user=session(c);
 if(!user || !['student','parent'].includes(user.role) || !user.student_id)return c.json({error:'Student or guardian sign-in required'},401);
 const student=one<{name:string;roll_no:string;class_name:string;academy_name:string}>(
  'SELECT s.name,s.roll_no,c.name AS class_name,i.name AS academy_name FROM students s JOIN classes c ON c.id=s.class_id JOIN institutions i ON i.id=c.institution_id WHERE s.id=? AND i.id=?',
  user.student_id,user.institution_id
 );
 if(!student)return c.json({error:'Account not found'},404);
 const attendance=all<{date:string;status:string}>(
  'SELECT date,status FROM attendance_logs WHERE student_id=? ORDER BY date DESC LIMIT 30',user.student_id
 );
 return c.json({student,attendance,role:user.role});
});

export default router;
