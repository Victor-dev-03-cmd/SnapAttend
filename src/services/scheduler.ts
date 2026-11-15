import {enqueueFeeReminders,flushNotifications} from './notifier.ts';
import {db} from '../db/index.ts';
let started=false,lastDay='';
export function startScheduler(){
 if(started)return;started=true;
 async function tick(){
 const day=new Date().toISOString().slice(0,10);
 if(day!==lastDay){lastDay=day;
 try{
  const now=new Date().toISOString();
  db.query('DELETE FROM safety_events WHERE expires_at < ?').run(now);
  db.query('DELETE FROM location_requests WHERE expires_at < ?').run(new Date(Date.now()-86400000).toISOString());
  db.query('DELETE FROM student_access_tokens WHERE expires_at < ?').run(now);
  enqueueFeeReminders();
 }catch(e){console.error('Scheduler error',e);}
 }
 try{await flushNotifications();}catch(e){console.error('Notifier error',e);}
 }
 void tick();setInterval(()=>void tick(),60000);
}