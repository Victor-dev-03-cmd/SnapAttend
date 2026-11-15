import {test,expect} from 'bun:test';
import app from '../src/backend.ts';
import {db} from '../src/db/index.ts';

function json(body:unknown,cookie=''){
 return {method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)};
}
const cookieOf=(response:Response)=>String(response.headers.get('set-cookie')||'').split(';')[0];
async function bodyOf(response:Response):Promise<any>{return response.json() as Promise<any>;}
test('multi-tenant academy onboarding and separately scoped role PINs',async()=>{
 const code='school-'+crypto.randomUUID().slice(0,8);
 const secondCode='school-'+crypto.randomUUID().slice(0,8);
 const schoolIds:string[]=[];
 try {
  const signup=await app.request('http://localhost/api/academies/register',json({
   name:'Example Test Academy',code,kind:'school',admin_pin:'0123',confirm_pin:'0123',public_listing:true
  }));
  expect(signup.status).toBe(201);
  const adminCookie=cookieOf(signup);
  expect(adminCookie.startsWith('sa_session=')).toBe(true);
  const signupBody=await bodyOf(signup);
  expect(signupBody.role).toBe('admin');
  const id=(db.query('SELECT id FROM institutions WHERE code=?').get(code) as {id:string}).id;
  schoolIds.push(id);
  const listed=await bodyOf(await app.request('http://localhost/api/academies?search='+code));
  expect(listed.academies.some((a:any)=>a.code===code)).toBe(true);
  const duplicate=await app.request('http://localhost/api/academies/register',json({
   name:'Other Name',code,kind:'school',admin_pin:'0123',confirm_pin:'0123',public_listing:true
  }));
  expect(duplicate.status).toBe(409);
  const invalid=await app.request('http://localhost/api/academies/register',json({
   name:'Invalid Academy',code:secondCode,kind:'school',admin_pin:'123',confirm_pin:'123',public_listing:true
  }));
  expect(invalid.status).toBe(400);
  const klass=await app.request('http://localhost/api/admin/classes',json({
   name:'Grade 8A',code:'grade-8a',teacher_pin:'2468'
  },adminCookie));
  expect(klass.status).toBe(201);
  const klassBody=await bodyOf(klass);
  const classId=klassBody.class.id;
  const studentId=crypto.randomUUID(),otherChild=crypto.randomUUID();
  db.query('INSERT INTO students(id,class_id,roll_no,name,parent_phone,parent_opt_in) VALUES(?,?,?,?,?,?)')
   .run(studentId,classId,'01','Example Student','+94770000001',1);
  db.query('INSERT INTO students(id,class_id,roll_no,name,parent_phone,parent_opt_in) VALUES(?,?,?,?,?,?)')
   .run(otherChild,classId,'02','Another Student','+94770000002',1);
  const createdPins=await app.request('http://localhost/api/admin/students/'+studentId+'/pins',json({
   student_pin:'1357',parent_pin:'8642'
  },adminCookie));
  expect(createdPins.status).toBe(200);
  expect((await bodyOf(createdPins)).student_pin_set).toBe(true);
  const stored=db.query('SELECT student_pin_hash,parent_pin_hash FROM student_pins WHERE student_id=?').get(studentId) as {
   student_pin_hash:string;parent_pin_hash:string
  };
  expect(stored.student_pin_hash).not.toBe('1357');
  expect(stored.parent_pin_hash).not.toBe('8642');
  const login=async(role:string,pin:string,roll='01')=>
   app.request('http://localhost/api/auth/login',json({
    institution_code:code,class_code:'grade-8a',roll_no:roll,role,pin
   }));
  const admin=await login('admin','0123');expect(admin.status).toBe(200);
  const teacher=await login('teacher','2468');expect(teacher.status).toBe(200);
  const teacherCookie=cookieOf(teacher);
  expect((await app.request('http://localhost/api/admin/summary',{headers:{cookie:teacherCookie}})).status).toBe(403);
  const student=await login('student','1357');expect(student.status).toBe(200);
  const studentCookie=cookieOf(student);
  const own=await bodyOf(await app.request('http://localhost/api/account/overview',{headers:{cookie:studentCookie}}));
  expect(own.student.roll_no).toBe('01');
  expect(own.role).toBe('student');
  expect((await app.request('http://localhost/api/classes',{headers:{cookie:studentCookie}})).status).toBe(403);
  expect((await app.request('http://localhost/api/admin/summary',{headers:{cookie:studentCookie}})).status).toBe(403);
  const guardian=await login('parent','8642');expect(guardian.status).toBe(200);
  const guardianCookie=cookieOf(guardian);
  const guardianSummary=await bodyOf(await app.request('http://localhost/api/account/overview',{headers:{cookie:guardianCookie}}));
  expect(guardianSummary.role).toBe('parent');
  expect(guardianSummary.student.roll_no).toBe('01');
  expect((await login('student','8642')).status).toBe(401);
  expect((await login('parent','1357')).status).toBe(401);
  expect((await login('student','1357','02')).status).toBe(401);
  expect((await login('teacher','1357')).status).toBe(401);
  expect((await login('admin','2468')).status).toBe(401);
  // Institution is resolved from academy code, not the user's choice of role.
  const other=await app.request('http://localhost/api/academies/register',json({
   name:'Other Test Academy',code:secondCode,kind:'campus',admin_pin:'7531',confirm_pin:'7531',public_listing:false
  }));
  expect(other.status).toBe(201);
  schoolIds.push((db.query('SELECT id FROM institutions WHERE code=?').get(secondCode) as {id:string}).id);
  expect((await app.request('http://localhost/api/auth/login',json({
   institution_code:secondCode,class_code:'grade-8a',roll_no:'01',role:'student',pin:'1357'
  }))).status).toBe(401);
  const hidden=await bodyOf(await app.request('http://localhost/api/academies?search='+secondCode));
  expect(hidden.academies.some((item:any)=>item.code===secondCode)).toBe(false);
 }finally{
  for(const id of schoolIds){
   db.query('DELETE FROM sessions WHERE institution_id=?').run(id);
   db.query('DELETE FROM institutions WHERE id=?').run(id);
  }
 }
});
