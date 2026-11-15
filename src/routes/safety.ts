import {Hono, type Context} from 'hono';
import {db, one, all} from '../db/index.ts';
import {session, requireLogin, requireAdmin} from '../lib/security.ts';
import {validateSafetyPosition, isSafetyKind, googleMapsLink} from '../lib/safety.ts';

type Student = {
  id: string;
  name: string;
  institution_id: string;
  class_name: string;
  parent_opt_in: number;
};
type RequestRow = {id:string; requested_at:string; expires_at:string};
type EventRow = {id:string; kind:string; student_name:string; class_name:string;latitude:number;longitude:number;accuracy_m:number;created_at:string;notification_status:string};

const router = new Hono();
const nowIso = () => new Date().toISOString();
const hash = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest('hex');

function studentFromToken(c:Context): Student | null {
  const token = c.req.header('x-student-token') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return one<Student>(
    'SELECT s.id,s.name,c.institution_id,c.name AS class_name,s.parent_opt_in FROM student_access_tokens t JOIN students s ON s.id=t.student_id JOIN classes c ON c.id=s.class_id WHERE t.token_hash=? AND t.expires_at>? AND s.parent_opt_in=1 AND s.parent_phone IS NOT NULL',
    hash(token),nowIso()
  );
}
function noStore(c:Context) {c.header('Cache-Control','no-store'); c.header('Referrer-Policy','no-referrer');}
function cleanExpired() {
  // No historical precise GPS tracking: remove expired coordinates from active SQLite.
  db.query('DELETE FROM safety_events WHERE expires_at < ?').run(nowIso());
  db.query("UPDATE location_requests SET status='expired' WHERE status='pending' AND expires_at < ?").run(nowIso());
}

// Access token must be delivered privately to an opted-in student. Do not add to URLs.
// A new token invalidates the previous token for this student.
router.post('/api/admin/students/:id/safety-access',requireLogin,requireAdmin,async c=>{
  noStore(c);
  const user=session(c)!;
  const studentId=c.req.param('id') || '';
  const student=one<{id:string;parent_opt_in:number;parent_phone:string|null}>(
    'SELECT s.id,s.parent_opt_in,s.parent_phone FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND c.institution_id=?',
    studentId,user.institution_id
  );
  if(!student)return c.json({error:'Student not found'},404);
  if(!student.parent_opt_in||!student.parent_phone)return c.json({error:'Guardian opt-in and a verified phone are required before enabling student location sharing'},409);
  const raw=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const expires_at=new Date(Date.now()+7*86400000).toISOString();
  db.transaction(()=>{
    db.query('DELETE FROM student_access_tokens WHERE student_id=?').run(studentId);
    db.query('INSERT INTO student_access_tokens(token_hash,student_id,expires_at) VALUES(?,?,?)').run(hash(raw),studentId,expires_at);
  })();
  return c.json({access_token:raw,expires_at,note:'Share privately with student. Never place token in URL or public chat.'});
});

// Admin can request a one-time response. This creates no GPS data and does not wake the student's device.
router.post('/api/admin/students/:id/location-request',requireLogin,requireAdmin,c=>{
  noStore(c);
  const user=session(c)!;
  const student=one<{id:string;parent_opt_in:number}>(
    'SELECT s.id,s.parent_opt_in FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=? AND c.institution_id=?',
    c.req.param('id') || '',user.institution_id
  );
  if(!student)return c.json({error:'Student not found'},404);
  if(!student.parent_opt_in)return c.json({error:'Guardian opt-in required'},409);
  const request=one<{id:string}>("SELECT id FROM location_requests WHERE student_id=? AND status='pending' AND expires_at>? ORDER BY requested_at DESC LIMIT 1",student.id,nowIso());
  if(request)return c.json({ok:true,request_id:request.id,notification_status:'not_configured'});
  const id=crypto.randomUUID();
  db.query('INSERT INTO location_requests(id,student_id,requested_at,expires_at) VALUES(?,?,?,?)')
    .run(id,student.id,nowIso(),new Date(Date.now()+15*60000).toISOString());
  return c.json({ok:true,request_id:id,notification_status:'not_configured',note:'Student must open the portal and approve sharing. Push notifications not configured.'},202);
});

// A sessionless browser cannot identify a minor. An admin-issued high-entropy token is required.
router.get('/api/student/me',c=>{
  noStore(c);
  const student=studentFromToken(c);
  if(!student)return c.json({error:'Student access expired or unavailable'},401);
  cleanExpired();
  const pending=all<RequestRow>(
    "SELECT id,requested_at,expires_at FROM location_requests WHERE student_id=? AND status='pending' AND expires_at>? ORDER BY requested_at DESC LIMIT 5",
    student.id,nowIso()
  );
  return c.json({student:{name:student.name,class_name:student.class_name},pending_requests:pending,delivery_mode:'not_configured'});
});

// Explicit per-event sharing only; never watchPosition, background collection or app-open capture.
// WhatsApp is intentionally NOT called here; real delivery requires opt-in/template/transport verification.
router.post('/api/student/safety-events',async c=>{
  noStore(c);
  const student=studentFromToken(c);
  if(!student)return c.json({error:'Student access expired or unavailable'},401);
  if(c.req.header('origin') && new URL(c.req.header('origin')!).origin !== new URL(c.req.url).origin)
    return c.json({error:'Origin mismatch'},403);
  const body=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body || body.consent_to_share !== true || !isSafetyKind(body.kind))
    return c.json({error:'Choose a safety action and explicitly confirm location sharing'},400);
  const kind=body.kind;
  const requestId=typeof body.request_id==='string'?body.request_id:null;
  const position=validateSafetyPosition(body.position);
  if(!position)return c.json({error:'Fresh GPS fix unavailable or invalid; nothing shared'},400);
  cleanExpired();
  if(kind==='parent_request'){
    if(!requestId)return c.json({error:'A pending verified request is required'},409);
    const request=one<RequestRow>("SELECT id,requested_at,expires_at FROM location_requests WHERE id=? AND student_id=? AND status='pending' AND expires_at>?",requestId,student.id,nowIso());
    if(!request)return c.json({error:'Request expired or already answered'},409);
  }
  const latest=one<{created_at:string}>(
    'SELECT created_at FROM safety_events WHERE student_id=? AND kind=? ORDER BY created_at DESC LIMIT 1',student.id,kind
  );
  if(latest && Date.now()-Date.parse(latest.created_at)<15000)
    return c.json({error:'This safety action was already submitted recently'},429);
  const id=crypto.randomUUID();
  const time=nowIso();
  db.transaction(()=>{
    db.query('INSERT INTO safety_events(id,student_id,institution_id,kind,latitude,longitude,accuracy_m,observed_at,created_at,expires_at,notification_status,location_request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,student.id,student.institution_id,kind,position.latitude,position.longitude,position.accuracy_m,position.observed_at,time,new Date(Date.now()+86400000).toISOString(),'not_configured',kind==='parent_request'?requestId:null);
    if(kind==='parent_request'){
      db.query("UPDATE location_requests SET status='shared' WHERE id=? AND student_id=? AND status='pending'").run(requestId,student.id);
    }
  })();
  return c.json({ok:true,event_id:id,map_url:googleMapsLink(position),accuracy_m:position.accuracy_m,
    notification_status:'not_configured',note:'Location recorded for 24h on a persistent Bun host. WhatsApp sending and push alerts are not configured.'},201);
});

// Admin visibility is tenant-scoped, session protected and limited to unexpired data.
router.get('/api/admin/safety-events',requireLogin,requireAdmin,c=>{
  noStore(c);
  cleanExpired();
  const user=session(c)!;
  const events=all<EventRow>(
    'SELECT e.id,e.kind,s.name AS student_name,c.name AS class_name,e.latitude,e.longitude,e.accuracy_m,e.created_at,e.notification_status FROM safety_events e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=s.class_id WHERE e.institution_id=? AND e.expires_at>? ORDER BY e.created_at DESC LIMIT 50',
    user.institution_id,nowIso()
  );
  return c.json({events:events.map(e=>({id:e.id,kind:e.kind,student_name:e.student_name,class_name:e.class_name,accuracy_m:e.accuracy_m,created_at:e.created_at,notification_status:e.notification_status,map_url:googleMapsLink({latitude:e.latitude,longitude:e.longitude})}))});
});

export default router;
