import { readFileSync } from "node:fs";
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t=l.trim(); if(t&&!t.startsWith("#")&&t.includes("=")){const i=t.indexOf("=");process.env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
}
const NOTION=process.env.NOTION_TOKEN;
const DB="be48663d7ede42349651f25b26a944f2";
const H={Authorization:`Bearer ${NOTION}`,"Notion-Version":"2022-06-28","Content-Type":"application/json"};
const dataISO=d=>{ if(!d) return null; const [dd,mm]=d.split("/"); if(!dd||!mm) return null; return `2026-${mm}-${dd}`; };
const itens=JSON.parse(readFileSync("/root/dashfin/itens.json","utf8"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ok=0, err=0;
for (const [cartao, lista] of Object.entries(itens)) {
  for (const it of lista) {
    const props={
      "Compra":{title:[{text:{content:(it.desc||"?").slice(0,90)}}]},
      "Cartão":{rich_text:[{text:{content:cartao}}]},
      "Valor":{number:it.val||0},
      "Fatura mês":{rich_text:[{text:{content:"Julho/26"}}]},
    };
    const di=dataISO(it.data); if(di) props["Data"]={date:{start:di}};
    const r=await fetch("https://api.notion.com/v1/pages",{method:"POST",headers:H,body:JSON.stringify({parent:{database_id:DB},properties:props})});
    if(r.ok) ok++; else { err++; if(err<=3) console.log("ERR", r.status, (await r.text()).slice(0,120)); }
    await sleep(120);
  }
}
console.log(`IMPORT FEITO: ok=${ok} err=${err}`);
