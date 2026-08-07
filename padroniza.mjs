// padroniza.mjs — arruma Forma de pagamento e 2 classificacoes na base de Gastos.
// rodar: node /tmp/padroniza.mjs        (vale)
//        node /tmp/padroniza.mjs --dry  (so mostra o que faria)
import { readFileSync } from "node:fs";
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t=l.trim(); if(t&&!t.startsWith("#")&&t.includes("=")){ const i=t.indexOf("="); process.env[t.slice(0,i).trim()]=t.slice(i+1).trim(); }
}
const NOTION = process.env.NOTION_TOKEN;
const DB = "7a2296707d8247eb9c205ec768d5a0d7";
const DRY = process.argv.includes("--dry");
const H = { Authorization:`Bearer ${NOTION}`, "Notion-Version":"2022-06-28", "Content-Type":"application/json" };

// apelido -> nome oficial (igual ao da base Contas & Cartoes)
const FORMA = {
  "Cartão Iara (dia 05)":"Cartão Iara Itaú (dia 08)",
  "Cartao Iara (dia 05)":"Cartão Iara Itaú (dia 08)",
  "Cartão Iara (dia 20)":"Cartão Iara Visa (dia 20)",
  "Cartao Iara (dia 20)":"Cartão Iara Visa (dia 20)",
  "Cartao Iara Visa (dia 20)":"Cartão Iara Visa (dia 20)",
  "Cartão XP (dia 05)":"Cartão XP - Wes",
  "Cartao XP (dia 05)":"Cartão XP - Wes",
  "Cartão Itaú 7046 (dia 17)":"Cartão Itau Gold 7046 - Wes",
  "Cartao Itau 7046 (dia 17)":"Cartão Itau Gold 7046 - Wes",
  "Cartao Nubank (dia 08)":"Cartão Iara Nubank (dia 08)",
  "Debito":"Débito",
};
// descricao -> classificacao certa
const RECLASS = [
  { re:/pai empr[ée]stimo/i, cat:"Divida", macro:"Divida", classe:null, nota:"parcela de divida com o pai" },
  { re:/banho jo[ãa]o/i,     cat:"Pet",    macro:"Pet",    classe:"Essencial", nota:"pet" },
];

const txt = p => p?.properties?.["Descrição"]?.title?.[0]?.plain_text || "";
const sel = (p,n) => p?.properties?.[n]?.select?.name || "";

async function query() {
  let out=[], cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method:"POST", headers:H, body:JSON.stringify(cursor?{start_cursor:cursor}:{}),
    });
    const d = await r.json();
    if (d.object!=="list") throw new Error(JSON.stringify(d).slice(0,200));
    out = out.concat(d.results||[]); cursor = d.has_more ? d.next_cursor : undefined;
  } while (cursor);
  return out;
}
async function patch(id, props) {
  const r = await fetch(`https://api.notion.com/v1/pages/${id}`, { method:"PATCH", headers:H, body:JSON.stringify({properties:props}) });
  if (!r.ok) console.log("  ERRO", id, (await r.text()).slice(0,120));
  await new Promise(s=>setTimeout(s,140));
}

const pages = await query();
console.log("lancamentos na base:", pages.length, DRY?"(DRY)":"");

let nForma=0, nClass=0;
for (const p of pages) {
  const props = {};
  const f = sel(p,"Forma de pagamento");
  if (f && FORMA[f] && FORMA[f] !== f) { props["Forma de pagamento"] = { select:{ name:FORMA[f] } }; nForma++; }
  const d = txt(p);
  for (const r of RECLASS) {
    if (r.re.test(d)) {
      props["Categoria"] = { select:{ name:r.cat } };
      props["Macro"]     = { select:{ name:r.macro } };
      props["Classe"]    = r.classe ? { select:{ name:r.classe } } : { select:null };
      nClass++;
      console.log("  reclass:", d, "->", r.macro, `(${r.nota})`);
      break;
    }
  }
  if (Object.keys(props).length && !DRY) await patch(p.id, props);
}
console.log(`forma de pagamento padronizada: ${nForma} | reclassificados: ${nClass}`);
console.log(DRY ? "DRY, nada gravado." : "OK, gravado.");
