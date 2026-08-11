// AUDITOR WI FINANCE - varre as bases e pega dupla contagem
// uso: node /root/bot-iara/auditor.mjs         (corrige o obvio e avisa no grupo)
//      node /root/bot-iara/auditor.mjs --dry   (nao altera nada, so mostra)
//      node /root/bot-iara/auditor.mjs --quiet (nao manda mensagem no Telegram)
import { readFileSync } from "fs";

const DRY = process.argv.includes("--dry");
const QUIET = process.argv.includes("--quiet");

const env = Object.fromEntries(
  readFileSync("/root/bot-iara/.env", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TK = env.NOTION_TOKEN, TG = env.TELEGRAM_BOT_TOKEN;
const GRUPO = "-5387464765";
const DB_GASTOS = "7a2296707d8247eb9c205ec768d5a0d7";
const DB_ITENS = "be48663d7ede42349651f25b26a944f2";
const H = { "Authorization": "Bearer " + TK, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
const dorme = ms => new Promise(r => setTimeout(r, ms));

// contas fixas e como o pagamento real aparece no extrato
const PARES = [
  { fixa: "Aluguel", pistas: ["susan", "aluguel"] },
  { fixa: "Condomínio", pistas: ["pjbank", "condomin"] },
  { fixa: "Luz", pistas: ["cpfl", "luz", "energia"] },
  { fixa: "Banho João", pistas: ["bicos e focinhos", "banho e tosa", "rodrigo"] },
  { fixa: "Clube", pistas: ["clube", "sandro"] },
  { fixa: "Aula de tênis", pistas: ["jorge", "tenis iara", "aula de tenis"] },
  { fixa: "Internet de casa (Arganet)", pistas: ["arganet"] },
  { fixa: "Seguro cartão", pistas: ["seguro cartao", "seguro cartão"] },
  { fixa: "Celulares (plano)", pistas: ["vivo", "celular"] },
  { fixa: "Farmácia (remédio contínuo)", pistas: ["droga raia", "drogaria", "farmacia"] },
  { fixa: "Unhas", pistas: ["manicure", "unha"] },
  { fixa: "Sobrancelha", pistas: ["sobrancelha", "designer"] },
];
// fixas de assinatura que caem no cartao: item de fatura NAO conta como pagamento real
const SO_CARTAO = ["Netflix", "Spotify", "Disney+", "Apple apps/iCloud", "MetLife odonto",
  "Amazon Prime", "Amazon Prime (canais)", "Amazon Prime (aluguel)", "Claude Max"];

const IGNORA = ["Duplicado", "Item Fatura"];

const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const txt = p => (p.properties["Descrição"]?.title || p.properties["Compra"]?.title || []).map(t => t.plain_text).join("");
const val = p => p.properties["Valor"]?.number || 0;
const dat = p => p.properties["Data"]?.date?.start || "";
const cat = p => p.properties["Categoria"]?.select?.name || "";
const tipo = p => p.properties["Tipo"]?.select?.name || "";
const cartao = p => (p.properties["Cartão"]?.rich_text || []).map(t => t.plain_text).join("");
const mesRef = p => (p.properties["Fatura mês"]?.rich_text || []).map(t => t.plain_text).join("");
const dias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

async function todas(db) {
  const out = []; let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: "POST", headers: H,
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 })
    });
    const j = await r.json();
    if (!j.results) { console.log("ERRO query:", JSON.stringify(j).slice(0, 250)); process.exit(1); }
    out.push(...j.results); cursor = j.has_more ? j.next_cursor : null; await dorme(140);
  } while (cursor);
  return out;
}

async function marcaDuplicado(p, motivo) {
  if (DRY) return true;
  const r = await fetch("https://api.notion.com/v1/pages/" + p.id, {
    method: "PATCH", headers: H,
    body: JSON.stringify({ properties: { "Categoria": { select: { name: "Duplicado" } }, "Observação": { rich_text: [{ text: { content: motivo.slice(0, 1900) } }] } } })
  });
  await dorme(140);
  return r.ok;
}

async function avisa(texto) {
  if (QUIET || DRY || !TG) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: GRUPO, text: texto })
  });
}

// ---------- carrega ----------
const gastos = (await todas(DB_GASTOS)).filter(p => !IGNORA.includes(cat(p)));
const itens = await todas(DB_ITENS);
const corrigidos = [], suspeitos = [];

// ---------- 1. fixa (provisao) contra pagamento real ----------
const fixas = gastos.filter(p => tipo(p) === "Fixo");
const reais = gastos.filter(p => tipo(p) !== "Fixo" && val(p) > 0);
for (const f of fixas) {
  const nome = txt(f);
  if (SO_CARTAO.includes(nome)) continue;
  const par = PARES.find(x => norm(x.fixa) === norm(nome));
  if (!par) continue;
  const mes = dat(f).slice(0, 7);
  const achado = reais.find(r => dat(r).slice(0, 7) === mes && par.pistas.some(pi => norm(txt(r)).includes(norm(pi))));
  if (!achado) continue;
  const motivo = `Auditor: provisao substituida pelo pagamento real "${txt(achado)}" de R$ ${val(achado).toFixed(2)} em ${dat(achado)}`;
  if (await marcaDuplicado(f, motivo)) corrigidos.push(`fixa ${nome} ${mes} (R$ ${val(f).toFixed(2)}) -> real R$ ${val(achado).toFixed(2)}`);
}

// ---------- 2. duplicata exata em Gastos: mesma data, mesmo valor ----------
const porChave = {};
for (const g of gastos) {
  if (tipo(g) === "Fixo") continue;
  const k = dat(g) + "|" + val(g).toFixed(2);
  (porChave[k] = porChave[k] || []).push(g);
}
const toks = s => norm(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length >= 4);
const parecido = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = toks(a), tb = toks(b);
  return ta.some(t => tb.includes(t));
};
for (const k of Object.keys(porChave)) {
  const lista = porChave[k].sort((a, b) => a.created_time.localeCompare(b.created_time));
  if (lista.length < 2) continue;
  // mantem o mais antigo. so corrige sozinho quando a descricao tambem bate
  for (const p of lista.slice(1)) {
    if (parecido(txt(p), txt(lista[0]))) {
      const motivo = `Auditor: mesma data, mesmo valor e mesma descricao de "${txt(lista[0])}" lancado antes (${lista[0].created_time.slice(0, 10)})`;
      if (await marcaDuplicado(p, motivo)) corrigidos.push(`repetido ${txt(p)} R$ ${val(p).toFixed(2)} ${dat(p)}`);
    } else {
      suspeitos.push(`mesmo dia e valor, descricao diferente: "${txt(lista[0])}" x "${txt(p)}" R$ ${val(p).toFixed(2)} ${dat(p)}`);
    }
  }
}

// ---------- 3. suspeitos: mesmo valor, ate 3 dias de diferenca ----------
const vivos = gastos.filter(g => cat(g) !== "Duplicado" && val(g) > 20);
for (let i = 0; i < vivos.length; i++) {
  for (let j = i + 1; j < vivos.length; j++) {
    const a = vivos[i], b = vivos[j];
    if (val(a).toFixed(2) !== val(b).toFixed(2)) continue;
    if (!dat(a) || !dat(b) || dat(a) === dat(b)) continue;
    if (dias(dat(a), dat(b)) > 3) continue;
    suspeitos.push(`R$ ${val(a).toFixed(2)}: "${txt(a)}" ${dat(a)} x "${txt(b)}" ${dat(b)}`);
  }
}

// ---------- 4. item de fatura repetido no mesmo cartao e mes ----------
const porItem = {};
for (const it of itens) {
  const k = cartao(it) + "|" + mesRef(it) + "|" + dat(it) + "|" + val(it).toFixed(2) + "|" + norm(txt(it));
  (porItem[k] = porItem[k] || []).push(it);
}
for (const k of Object.keys(porItem)) {
  if (porItem[k].length < 2) continue;
  const l = porItem[k];
  suspeitos.push(`fatura ${cartao(l[0])}: "${txt(l[0])}" R$ ${val(l[0]).toFixed(2)} ${dat(l[0])} aparece ${l.length}x`);
}

// ---------- relatorio ----------
let msg = DRY ? "AUDITORIA (simulacao, nada foi alterado)\n" : "Auditoria do dia\n";
msg += `\nCorrigidos sozinho: ${corrigidos.length}`;
corrigidos.slice(0, 15).forEach(c => msg += `\n- ${c}`);
if (corrigidos.length > 15) msg += `\n- ... e mais ${corrigidos.length - 15}`;
msg += `\n\nPra voce olhar: ${suspeitos.length}`;
suspeitos.slice(0, 12).forEach(s => msg += `\n- ${s}`);
if (suspeitos.length > 12) msg += `\n- ... e mais ${suspeitos.length - 12}`;
if (!corrigidos.length && !suspeitos.length) msg = "Auditoria do dia: nada duplicado. Bases limpas.";

console.log(msg);
if (corrigidos.length || suspeitos.length) await avisa(msg);
console.log("\nAUDITOR FIM. corrigidos=" + corrigidos.length + " suspeitos=" + suspeitos.length);
