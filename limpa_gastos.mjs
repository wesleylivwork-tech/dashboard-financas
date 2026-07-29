import { readFileSync } from "node:fs";
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t=l.trim(); if(t&&!t.startsWith("#")&&t.includes("=")){const i=t.indexOf("=");process.env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
}
const NOTION=process.env.NOTION_TOKEN;
const DB="7a2296707d8247eb9c205ec768d5a0d7";
const H={Authorization:`Bearer ${NOTION}`,"Notion-Version":"2022-06-28","Content-Type":"application/json"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function query(){let res=[],cur;do{const r=await fetch(`https://api.notion.com/v1/databases/${DB}/query`,{method:"POST",headers:H,body:JSON.stringify(cur?{start_cursor:cur}:{})});const d=await r.json();res=res.concat(d.results||[]);cur=d.has_more?d.next_cursor:null;}while(cur);return res;}
const txt=p=>p.properties?.Descrição?.title?.[0]?.plain_text||"";
const lug=p=>p.properties?.Lugar?.rich_text?.[0]?.plain_text||"";
const val=p=>p.properties?.Valor?.number||0;
const cat=p=>p.properties?.Categoria?.select?.name||"";
const dta=p=>p.properties?.Data?.date?.start||p.created_time||"";
async function setCat(id,nome,obs){const props={Categoria:{select:{name:nome}}};if(obs)props["Observação"]={rich_text:[{text:{content:obs}}]};const r=await fetch(`https://api.notion.com/v1/pages/${id}`,{method:"PATCH",headers:H,body:JSON.stringify({properties:props})});return r.ok;}

const pages=(await query()).filter(p=>!p.archived);
let terc={Yago:0,Patricia:0,Fatech:0}, fatura=0, dedup=0;

// PASSO 1: terceiros -> categoria "Terceiros" + obs nome (NAO apaga)
for(const p of pages){
  const s=(txt(p)+" "+lug(p)).toLowerCase();
  let nome=null;
  if(/\byago\b/.test(s)) nome="Yago"; else if(/patr[ií]cia|\[patr/.test(s)) nome="Patricia"; else if(/fatech/.test(s)) nome="Fatech";
  if(nome && cat(p)!=="Terceiros"){ if(await setCat(p.id,"Terceiros","Terceiro: "+nome)){terc[nome]++;} await sleep(120); p._done="terc"; }
}
// PASSO 2: itens de fatura ja presentes na base Itens de Fatura -> categoria "Item Fatura" (NAO apaga; so nao conta)
for(const p of pages){
  if(p._done) continue;
  if(/- fatura|- fat\.|fatura ita|fatura nubank|fat\.mc|fat\.visa/i.test(txt(p))){ if(await setCat(p.id,"Item Fatura","Ja consta na aba de faturas do cartao")){fatura++;} await sleep(120); p._done="fat"; }
}
// PASSO 3: dedup fixos (mesmo valor no mes; um do extrato e um manual -> marca o manual como "Duplicado")
const grupos={};
for(const p of pages){ if(p._done) continue; const k=(dta(p).slice(0,7))+"|"+val(p).toFixed(2); (grupos[k]=grupos[k]||[]).push(p); }
for(const k in grupos){
  const g=grupos[k]; if(g.length<2||val(g[0])<150) continue;
  const ext=g.find(p=>/ext\.|extrato/i.test(txt(p))); const man=g.find(p=>!/ext\.|extrato/i.test(txt(p)));
  if(ext&&man&&ext!==man){ if(await setCat(man.id,"Duplicado","Repetido: ja consta pelo extrato")){dedup++;} await sleep(120); }
}
console.log("TERCEIROS:",JSON.stringify(terc),"| itens_fatura_marcados:",fatura,"| duplicatas_marcadas:",dedup);
