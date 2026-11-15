import {test,expect} from 'bun:test';

test('mobile entry HTML provides every control required by Mango app.js',async()=>{
 const html=await Bun.file(new URL('../public/index.html',import.meta.url)).text();
 const script=await Bun.file(new URL('../public/app.js',import.meta.url)).text();
 const ids=Array.from(script.matchAll(/\$\('([a-z][a-z0-9-]*)'\)/g),m=>m[1]);
 for(const id of new Set(ids)){
  expect(html.includes('id="'+id+'"')).toBe(true);
 }
 expect(html.includes('id="tab-signin"')).toBe(true);
 expect(html.includes('id="tab-register"')).toBe(true);
 expect(html.includes('id="academy-search"')).toBe(true);
 expect(html.includes('id="academy-private-code"')).toBe(true);
 expect(html.includes('id="family-role"')).toBe(true);
 expect(html.includes('id="reg-pin"')).toBe(true);
 expect(html.includes('id="reg-confirm"')).toBe(true);
 expect(html.includes('src="/mango.js"')).toBe(true);
 expect(script.includes("role:'parent'")).toBe(false); // no privileged role granted from client state
});
