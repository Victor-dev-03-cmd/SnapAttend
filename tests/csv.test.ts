import {test,expect} from 'bun:test';
import {parseCSV} from '../src/lib/csv.ts';
test('quoted comma and quoted newlines',()=>{
 expect(parseCSV('roll_no,name\n1,"Ana, B"\n2,"J\nK"')).toEqual([['roll_no','name'],['1','Ana, B'],['2','J\nK']]);
});
test('rejects unterminated quote',()=>expect(()=>parseCSV('1,"no')).toThrow());