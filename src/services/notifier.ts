import {db,all} from '../db/index.ts';
type Job={id:string;kind:string;student_id:string;parent_phone:string|null;parent_opt_in:number;student_name:string;date:string|null};
let running=false;
export async function flushNotifications(){
 if(running)return;running=true;
 try{
 const jobs=all<Job>(`SELECT j.id,j.kind,j.student_id,s.parent_phone,s.parent_opt_in,s.name AS student_name,
 a.date FROM notification_jobs j JOIN students s ON s.id=j.student_id
 LEFT JOIN attendance_logs a ON a.id=j.attendance_id WHERE j.status='queued' ORDER BY j.created_at LIMIT 100`);
 for(const j of jobs){
  if(!j.parent_opt_in||!j.parent_phone){db.query("UPDATE notification_jobs SET status='skipped' WHERE id=?").run(j.id);continue;}
  // Never silently send real messages. Meta Cloud API requires opt-in and approved templates.
  if((process.env.NOTIFIER_MODE||'mock')!=='mock'){console.error('WhatsApp delivery unconfigured: refusing to send');break;}
  console.info('[Safe-Reach MOCK]',j.kind,j.student_name,j.date,'phone redacted');
  db.query("UPDATE notification_jobs SET status='sent' WHERE id=?").run(j.id);
 }
 }finally{running=false;}
}
export function enqueueFeeReminders(){
 const today=new Date().toISOString().slice(0,10);
 const due=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 const rows=all<{id:string;fee_due_date:string}>(
  `SELECT s.id,s.fee_due_date FROM students s JOIN classes c ON c.id=s.class_id
  JOIN institutions i ON i.id=c.institution_id WHERE s.parent_opt_in=1 AND s.parent_phone IS NOT NULL
  AND s.fee_status='pending' AND s.fee_due_date BETWEEN ? AND ? AND i.active_until>=?`,today,due,today);
 for(const s of rows)db.query('INSERT OR IGNORE INTO notification_jobs(id,dedupe_key,kind,student_id) VALUES(?,?,?,?)')
  .run(crypto.randomUUID(),'fee:'+s.id+':'+s.fee_due_date,'fee',s.id);
 return rows.length;
}