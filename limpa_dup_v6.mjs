// arquiva as duplicatas do reprocessamento do extrato do Wes (lote "Ext.Wes" de 11/08)
// mantem os itens que nao existiam antes. rodar: node /root/bot-iara/limpa_dup_v6.mjs
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/root/bot-iara/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TK = env.NOTION_TOKEN;
const DB = "7a2296707d8247eb9c205ec768d5a0d7";
const H = { "Authorization": "Bearer " + TK, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
const dorme = ms => new Promise(r => setTimeout(r, ms));

async function todas() {
  const out = []; let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: "POST", headers: H,
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 })
    });
    const j = await r.json();
    if (!j.results) { console.log("ERRO:", JSON.stringify(j).slice(0, 300)); process.exit(1); }
    out.push(...j.results); cursor = j.has_more ? j.next_cursor : null; await dorme(150);
  } while (cursor);
  return out;
}

const txt = p => (p.properties["Descrição"]?.title || []).map(t => t.plain_text).join("");
const val = p => p.properties["Valor"]?.number;
const dat = p => p.properties["Data"]?.date?.start || "";

const paginas = await todas();
console.log("total:", paginas.length);

const lote = paginas.filter(p => txt(p).includes("Ext.Wes") && dat(p) < "2026-08-01");
const antigos = paginas.filter(p => !txt(p).includes("Ext.Wes") && p.created_time < "2026-08-11T00:00:00.000Z");
console.log("lote Ext.Wes de julho:", lote.length, "| lancamentos anteriores:", antigos.length);

// quantas copias existem "de verdade" (lote antigo) para cada valor+data
const chave = p => val(p) + "|" + dat(p);
const capacidade = {};
for (const p of antigos) { const k = chave(p); capacidade[k] = (capacidade[k] || 0) + 1; }

const arquivar = [];
const manter = [];
for (const p of lote) {
  const k = chave(p);
  if (capacidade[k] > 0) { capacidade[k]--; arquivar.push(p); } else manter.push(p);
}

console.log("a arquivar (duplicata):", arquivar.length, "| a manter (item novo):", manter.length);
console.log("mantidos:", manter.map(p => txt(p) + " R$" + val(p) + " " + dat(p)));
console.log("soma arquivada: R$", arquivar.reduce((s, p) => s + (val(p) || 0), 0).toFixed(2));

let ok = 0, erro = 0;
for (const p of arquivar) {
  const r = await fetch("https://api.notion.com/v1/pages/" + p.id, {
    method: "PATCH", headers: H, body: JSON.stringify({ archived: true })
  });
  if (r.ok) ok++; else { erro++; console.log("falhou", p.id, (await r.text()).slice(0, 140)); }
  await dorme(130);
}
console.log("LIMPA DUP V6 FIM. arquivados=" + ok + " erro=" + erro);
