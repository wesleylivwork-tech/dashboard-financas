import { readFileSync } from "node:fs";
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t=l.trim(); if(t&&!t.startsWith("#")&&t.includes("=")){const i=t.indexOf("=");process.env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
}
const NOTION=process.env.NOTION_TOKEN, DB="1941663727fa46afb6dab84a6cfcb8d9";
const H={Authorization:`Bearer ${NOTION}`,"Notion-Version":"2022-06-28","Content-Type":"application/json"};
const r=await fetch(`https://api.notion.com/v1/databases/${DB}/query`,{method:"POST",headers:H,body:JSON.stringify({})});
const d=await r.json();
const txt=(p,n)=>p.properties?.[n]?.rich_text?.[0]?.plain_text||p.properties?.[n]?.title?.[0]?.plain_text||"";
const alvo=(d.results||[]).find(p=>txt(p,"Ano-Mês")==="2026-07")||(d.results||[])[0];
if(!alvo){console.log("linha julho nao achada");process.exit(1);}
const up=await fetch(`https://api.notion.com/v1/pages/${alvo.id}`,{method:"PATCH",headers:H,body:JSON.stringify({properties:{"Renda":{number:27000},"Meta investimento":{number:2700},"Observação":{rich_text:[{text:{content:"Iara ~10k (5+5) · Wes ~17k · média jul/26"}}]}}})});
console.log("RENDA JULHO:", up.ok?"27000 OK":("ERR "+up.status+" "+(await up.text()).slice(0,100)));
