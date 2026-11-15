import {test,expect} from 'bun:test';
import {db} from '../src/db/index.ts';
test('SQLite schema and foreign keys initialize in Bun',()=>{
 const names=db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
 expect(names).toContain('institutions');
 expect(names).toContain('classes');
 expect(names).toContain('students');
 expect(names).toContain('attendance_logs');
 expect(names).toContain('sessions');
 expect((db.query('PRAGMA foreign_keys').get() as any).foreign_keys).toBe(1);
});