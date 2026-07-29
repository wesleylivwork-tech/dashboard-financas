import { readFileSync } from "node:fs";
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t=l.trim(); if(t&&!t.startsWith("#")&&t.includes("=")){const i=t.indexOf("=");process.env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
}
const NOTION=process.env.NOTION_TOKEN;
const DB="be48663d7ede42349651f25b26a944f2";
const H={Authorization:`Bearer ${NOTION}`,"Notion-Version":"2022-06-28","Content-Type":"application/json"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 1) garante a propriedade "Terceiro" na base
let r=await fetch(`https://api.notion.com/v1/databases/${DB}`,{method:"PATCH",headers:H,body:JSON.stringify({properties:{Terceiro:{rich_text:{}}}})});
console.log("add prop Terceiro:", r.ok?"ok":("ERR "+r.status));
await sleep(400);
// 2) query itens
async function query(){let res=[],cur;do{const rr=await fetch(`https://api.notion.com/v1/databases/${DB}/query`,{method:"POST",headers:H,body:JSON.stringify(cur?{start_cursor:cur}:{})});const d=await rr.json();res=res.concat(d.results||[]);cur=d.has_more?d.next_cursor:null;}while(cur);return res;}
const compra=p=>p.properties?.Compra?.title?.[0]?.plain_text||"";
const items=await query();
let cont={Yago:0,Patricia:0,Fatech:0};
for(const p of items){
  const s=compra(p).toLowerCase();
  let nome=null;
  if(/\byago\b/.test(s)) nome="Yago";
  else if(/patr[ií]cia|\[patr/.test(s)) nome="Patricia";
  else if(/fatech|f[aá]bio rog|63\.?992\.?833|33\.?362\.?677/.test(s)) nome="Fatech";
  if(nome){
    const rr=await fetch(`https://api.notion.com/v1/pages/${p.id}`,{method:"PATCH",headers:H,body:JSON.stringify({properties:{Terceiro:{rich_text:[{text:{content:nome}}]}}})});
    if(rr.ok) cont[nome]++; await sleep(120);
  }
}
console.log("ITENS FATURA marcados terceiro:", JSON.stringify(cont));
