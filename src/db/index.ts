import {Database} from 'bun:sqlite';
const dir=process.env.DATA_DIR||'./data';
await Bun.$`mkdir -p ${dir}`.quiet();
export const db=new Database(`${dir}/snapattend.sqlite`,{create:true});
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(await Bun.file(new URL('./schema.sql',import.meta.url)).text());
// Additive migration for SQLite databases created before multi-tenant enrollment.
function ensureColumn(table:string, name:string, sql:string) {
 const cols=db.query('PRAGMA table_info('+table+')').all() as Array<{name:string}>;
 if(!cols.some(col=>col.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+sql);
}
ensureColumn('institutions','kind',"kind TEXT NOT NULL DEFAULT 'academy'");
ensureColumn('institutions','is_listed','is_listed INTEGER NOT NULL DEFAULT 1');
ensureColumn('sessions','student_id','student_id TEXT');

const oldSessionsSchema=db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get() as {sql:string}|null;
if(oldSessionsSchema?.sql?.includes("role IN ('admin','teacher')")){
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(`CREATE TABLE sessions_upgrade (
   token_hash TEXT PRIMARY KEY,
   institution_id TEXT NOT NULL REFERENCES institutions(id),
   class_id TEXT,
   role TEXT NOT NULL CHECK(role IN ('admin','teacher','student','parent')),
   expires_at TEXT NOT NULL,
   student_id TEXT
  )`);
  db.exec('INSERT INTO sessions_upgrade(token_hash,institution_id,class_id,role,expires_at,student_id) SELECT token_hash,institution_id,class_id,role,expires_at,student_id FROM sessions');
  db.exec('DROP TABLE sessions');
  db.exec('ALTER TABLE sessions_upgrade RENAME TO sessions');
  db.exec('COMMIT');
 } catch(error) {
  db.exec('ROLLBACK');
  throw error;
 }
}


export const all=<T=any>(sql:string,...a:any[]):T[]=>db.query(sql).all(...a) as T[];
export const one=<T=any>(sql:string,...a:any[]):T|null=>(db.query(sql).get(...a) as T|null);
export const exec=(sql:string,...a:any[])=>db.query(sql).run(...a);