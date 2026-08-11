// padroniza os nomes de cartao na BASE 1 (Gastos) para os nomes oficiais da BASE 2
// rodar na VPS: node /root/bot-iara/padroniza_cartoes_v6.mjs
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/root/bot-iara/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TK = env.NOTION_TOKEN;
const DB = "7a2296707d8247eb9c205ec768d5a0d7";
const H = { "Authorization": "Bearer " + TK, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };

const MAPA = {
  "Cartão Iara Itaú (dia 08)": "Pão de Açúcar - Iara",
  "Cartao Iara Itau (dia 08)": "Pão de Açúcar - Iara",
  "Cartão Iara (dia 05)": "Pão de Açúcar - Iara",
  "Cartao Iara (dia 05)": "Pão de Açúcar - Iara",
  "Cartão Iara Nubank (dia 08)": "Nubank - Iara",
  "Cartao Iara Nubank (dia 08)": "Nubank - Iara",
  "Cartao Nubank (dia 08)": "Nubank - Iara",
  "Cartão Iara Visa (dia 20)": "Latam Visa - Iara",
  "Cartao Iara Visa (dia 20)": "Latam Visa - Iara",
  "Cartão Iara (dia 20)": "Latam Visa - Iara",
  "Cartao Iara (dia 20)": "Latam Visa - Iara",
  "Cartão XP (dia 05)": "XP - Wes",
  "Cartão XP - Wes": "XP - Wes",
  "Cartão Itaú 7046 (dia 17)": "Itaú Gold - Wes",
  "Cartao Itau 7046 (dia 17)": "Itaú Gold - Wes",
  "Cartão Itau Gold 7046 - Wes": "Itaú Gold - Wes",
  "Cartão Pão de Açúcar Black 1009 - Wes": "Adicional do Wes (final 1009)",
  "Debito": "Débito",
};

const dorme = ms => new Promise(r => setTimeout(r, ms));

async function todas() {
  const out = []; let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: "POST", headers: H,
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 })
    });
    const j = await r.json();
    if (!j.results) { console.log("ERRO query:", JSON.stringify(j).slice(0, 300)); process.exit(1); }
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : null;
    await dorme(150);
  } while (cursor);
  return out;
}

const paginas = await todas();
console.log("total de lancamentos:", paginas.length);

const fila = [];
for (const p of paginas) {
  const sel = p.properties["Forma de pagamento"]?.select?.name;
  if (sel && MAPA[sel] && MAPA[sel] !== sel) fila.push({ id: p.id, de: sel, para: MAPA[sel] });
}
const cont = {};
fila.forEach(f => { cont[f.de + " -> " + f.para] = (cont[f.de + " -> " + f.para] || 0) + 1; });
console.log("a corrigir:", fila.length);
console.log(cont);

let ok = 0, erro = 0;
for (const f of fila) {
  const r = await fetch("https://api.notion.com/v1/pages/" + f.id, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ properties: { "Forma de pagamento": { select: { name: f.para } } } })
  });
  if (r.ok) ok++; else { erro++; console.log("falhou", f.id, (await r.text()).slice(0, 160)); }
  await dorme(130);
  if ((ok + erro) % 25 === 0) console.log("...", ok + erro, "/", fila.length);
}
console.log("PADRONIZA V6 FIM. ok=" + ok + " erro=" + erro);
