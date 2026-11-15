// RFC-4180-style quoted CSV parser; handles commas, quoted newlines and escaped quotes.
export function parseCSV(text:string):string[][]{
 const out:string[][]=[];let row:string[]=[],field='',quoted=false,endedQuote=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"'){quoted=false;endedQuote=true;}else field+=ch;continue;}
  if(ch==='"'&&!field&&!endedQuote){quoted=true;continue;}
  if(ch===','){row.push(field);field='';endedQuote=false;continue;}
  if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))out.push(row);row=[];field='';endedQuote=false;continue;}
  if(endedQuote&&ch!==' '&&ch!=='\t')throw Error('Invalid CSV quotes');
  if(!endedQuote)field+=ch;
 }
 if(quoted)throw Error('Unclosed CSV quote');
 row.push(field);if(row.some(Boolean))out.push(row);
 return out;
}