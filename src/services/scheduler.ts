import {enqueueFeeReminders,flushNotifications} from './notifier.ts';
let started=false,lastDay='';
export function startScheduler(){
 if(started)return;started=true;
 async function tick(){
 const day=new Date().toISOString().slice(0,10);
 if(day!==lastDay){lastDay=day;try{enqueueFeeReminders();}catch(e){console.error('Fee scheduler error',e);}}
 try{await flushNotifications();}catch(e){console.error('Notifier error',e);}
 }
 void tick();setInterval(()=>void tick(),60000);
}