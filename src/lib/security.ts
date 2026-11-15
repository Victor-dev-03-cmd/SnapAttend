import type {Context,Next} from 'hono';
import {getCookie,setCookie,deleteCookie} from 'hono/cookie';
import {db,one} from '../db/index.ts';
export type Session={role:'teacher'|'admin',institution_id:string,class_id:string|null};
const hash=(token:string)=>new Bun.CryptoHasher('sha256').update(token).digest('hex');
const cookie='sa_session';
export function session(c:Context):Session|null{
 const token=getCookie(c,cookie);if(!token)return null;
 return one<Session>('SELECT role,institution_id,class_id FROM sessions WHERE token_hash=? AND expires_at>?',hash(token),new Date().toISOString());
}
export function setSession(c:Context,s:Session){
 const token=crypto.randomUUID()+crypto.randomUUID();
 db.query('INSERT INTO sessions(token_hash,role,institution_id,class_id,expires_at) VALUES(?,?,?,?,?)')
  .run(hash(token),s.role,s.institution_id,s.class_id,new Date(Date.now()+12*3600000).toISOString());
 setCookie(c,cookie,token,{httpOnly:true,sameSite:'Lax',secure:process.env.APP_ENV==='production',path:'/',maxAge:43200});
}
export function clearSession(c:Context){const token=getCookie(c,cookie);if(token)db.query('DELETE FROM sessions WHERE token_hash=?').run(hash(token));deleteCookie(c,cookie,{path:'/'});}
export async function requireLogin(c:Context,next:Next){
 if(!session(c))return c.json({error:'Sign in required'},401);
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
  const origin=c.req.header('origin');if(origin&&new URL(origin).host!==new URL(c.req.url).host)return c.json({error:'Origin mismatch'},403);
 }
 await next();
}
export async function requireAdmin(c:Context,next:Next){if(session(c)?.role!=='admin')return c.json({error:'Administrator access required'},403);await next();}
export function allowedClass(c:Context,id:string):boolean{
 const s=session(c);if(!s)return false;
 return !!one('SELECT 1 FROM classes WHERE id=? AND institution_id=?',id,s.institution_id)&&(s.role==='admin'||s.class_id===id);
}
export function subscribed(c:Context){
 const s=session(c);if(!s)return false;
 const i=one<{active_until:string}>('SELECT active_until FROM institutions WHERE id=?',s.institution_id);
 return !!i&&i.active_until>=new Date().toISOString().slice(0,10);
}