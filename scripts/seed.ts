import {db} from '../src/db/index.ts';
const school=crypto.randomUUID(),cls=crypto.randomUUID();
const schoolCode='demo-school',classCode='grade-8a';
if(db.query('SELECT id FROM institutions WHERE code=?').get(schoolCode)){
 console.log('Demo already seeded');process.exit(0);
}
const active=new Date(Date.now()+15*86400000).toISOString().slice(0,10);
db.query('INSERT INTO institutions(id,code,name,admin_hash,active_until) VALUES(?,?,?,?,?)')
 .run(school,schoolCode,'SnapAttend Demo School',await Bun.password.hash('1357',{algorithm:'argon2id'}),active);
db.query('INSERT INTO classes(id,institution_id,code,name,teacher_pin_hash) VALUES(?,?,?,?,?)')
 .run(cls,school,classCode,'Grade 8 A',await Bun.password.hash('2468'));
for(let i=1;i<=12;i++)db.query('INSERT INTO students(id,class_id,roll_no,name) VALUES(?,?,?,?)')
 .run(crypto.randomUUID(),cls,String(i).padStart(2,'0'),'Demo Student '+i);
console.log('Demo sign-in: demo-school / grade-8a / teacher PIN 2468; admin PIN 1357 (local development only).');