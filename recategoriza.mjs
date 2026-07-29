import { readFileSync } from "node:fs";
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t=l.trim(); if(t&&!t.startsWith("#")&&t.includes("=")){const i=t.indexOf("=");process.env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
}
const NOTION=process.env.NOTION_TOKEN;
const DB="7a2296707d8247eb9c205ec768d5a0d7";
const H={Authorization:`Bearer ${NOTION}`,"Notion-Version":"2022-06-28","Content-Type":"application/json"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// regras: retorna categoria nova ou null (deixa como está)
function classifica(desc, lugar){
  const s=(desc+" "+(lugar||"")).toLowerCase();
  if(/transf\.?\s*interna|transfer[eê]ncia interna|pix iara|pix wesley/.test(s)) return "Transferência";
  if(/empr[eé]stim|d[ií]vida|wanderley|guilherme|pai empr|repasse irm|aibr fidc|parcelamento conjunto|elisangela|m[ãa]e/.test(s)) return "Dívida";
  if(/\bjuros\b|\biof\b|seguro cart|anuidade|pjbank/.test(s)) return "Taxas";
  if(/petz|banho jo[ãa]o|tapete higi/.test(s)) return "Pet";
  if(/\bunha|sobrancelha|cabelo|est[eé]tica/.test(s)) return "Estética";
  if(/amazon|mercado livre|\bhavan\b|kalunga|maravilhas|varejista|shopee|magalu|americanas/.test(s)) return "Compras";
  if(/\brecre\b|\bora p\b|\bf a\b|\bmp l\b|\bph br\b|\bwe pu\b|\bclm p\b|\bponto\b|52131|energ[ée]tic/.test(s)) return "Conveniência";
  if(/presente/.test(s)) return "Lazer";
  return null; // ambíguo: fica em Outros
}

async function query(){
  let res=[],cur;
  do{
    const r=await fetch(`https://api.notion.com/v1/databases/${DB}/query`,{method:"POST",headers:H,body:JSON.stringify(cur?{start_cursor:cur}:{})});
    const d=await r.json(); res=res.concat(d.results||[]); cur=d.has_more?d.next_cursor:null;
  }while(cur);
  return res;
}
const catAtual=p=>p.properties?.Categoria?.select?.name||"";
const txt=p=>p.properties?.Descrição?.title?.[0]?.plain_text||"";
const lug=p=>p.properties?.Lugar?.rich_text?.[0]?.plain_text||"";

const pages=await query();
const cont={}; let mudou=0, ficou=0;
for(const p of pages){
  if(catAtual(p)!=="Outros" && catAtual(p)!=="") continue; // só mexe em Outros/vazio
  const nova=classifica(txt(p),lug(p));
  if(!nova){ ficou++; continue; }
  const r=await fetch(`https://api.notion.com/v1/pages/${p.id}`,{method:"PATCH",headers:H,body:JSON.stringify({properties:{Categoria:{select:{name:nova}}}})});
  if(r.ok){ cont[nova]=(cont[nova]||0)+1; mudou++; } else if(mudou<3){ console.log("ERR",r.status,(await r.text()).slice(0,100)); }
  await sleep(130);
}
console.log("RECATEGORIZADO:", JSON.stringify(cont), "| mudou:", mudou, "| ficou em Outros:", ficou);
