import { readFileSync, writeFileSync } from "node:fs";

// ===== carrega .env =====
for (const l of readFileSync("/root/bot-iara/.env","utf8").split("\n")) {
  const t = l.trim();
  if (t && !t.startsWith("#") && t.includes("=")) {
    const i = t.indexOf("=");
    process.env[t.slice(0,i).trim()] = t.slice(i+1).trim();
  }
}

const NOTION = process.env.NOTION_TOKEN;
const GH = process.env.GH_TOKEN;
const REPO = process.env.REPO || "wesleylivwork-tech/dashboard-financas";

const DB_CONTAS = "bf5a6857321b49ce98d683d1a7822c91";
const DB_GASTOS = "7a2296707d8247eb9c205ec768d5a0d7";
const DB_MENSAL = "1941663727fa46afb6dab84a6cfcb8d9";
const DB_ITENS  = "be48663d7ede42349651f25b26a944f2";

const DRY = process.argv.includes("--dry");

// ===== helpers Notion =====
async function query(db, body={}) {
  let results = [], cursor = undefined;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${NOTION}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    const d = await r.json();
    if (d.object !== "list") throw new Error("Notion erro: " + JSON.stringify(d).slice(0,120));
    results = results.concat(d.results || []);
    cursor = d.has_more ? d.next_cursor : undefined;
  } while (cursor);
  return results;
}
const num = (p,n) => { const v=p?.properties?.[n]; return v && typeof v.number==="number" ? v.number : null; };
const txt = (p,n) => { const a=p?.properties?.[n]?.rich_text || p?.properties?.[n]?.title || []; return a[0]?.plain_text || ""; };
const sel = (p,n) => p?.properties?.[n]?.select?.name || "";
const dateStart = (p,n) => p?.properties?.[n]?.date?.start || "";

// ===== formatacao =====
const fmt = v => {
  if (v == null) return "-";
  const s = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1000) return `${s}R$ ${(a/1000).toFixed(a>=10000?0:1).replace(".",",")}k`;
  return `${s}R$ ${Math.round(a)}`;
};
const fmtFull = v => v==null ? "-" : (v<0?"-":"") + "R$ " + Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0});
const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const dataBR = iso => { if(!iso) return ""; const [a,m,d]=iso.slice(0,10).split("-"); return `${d}/${m}`; };

// ===== coleta =====
async function coletar() {
  const [contas, gastos, mensal] = await Promise.all([
    query(DB_CONTAS), query(DB_GASTOS), query(DB_MENSAL),
  ]);
  // itens de fatura (base separada; tolerante a erro/acesso)
  let itensFat = [];
  try { itensFat = await query(DB_ITENS); } catch(e) { itensFat = []; }

  const hoje = new Date();
  const anoMes = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,"0")}`;
  const mesRef = mensal.find(p => txt(p,"Ano-Mês") === anoMes) || mensal.sort((a,b)=>txt(b,"Ano-Mês").localeCompare(txt(a,"Ano-Mês")))[0];

  const renda = num(mesRef,"Renda") || 0;
  const investido = num(mesRef,"Investido") || 0;
  const meta = renda * 0.1;

  // data do gasto: usa campo Data se existir, senao created_time
  const dataGasto = p => (dateStart(p,"Data") || p.created_time || "").slice(0,10);
  // categorias que NAO sao consumo do casal (nao entram no "Saiu no mes" nem na rosca)
  const NAO_CONSUMO = ["Transferência","Transferencia","Dívida","Divida","Taxas","Terceiros","Item Fatura","Duplicado"];
  const ehConsumo = p => !NAO_CONSUMO.includes(sel(p,"Categoria"));
  // terceiros (gasto de outra pessoa no cartao do casal) agrupado por nome
  // fontes: base de Gastos (categoria Terceiros) + base Itens de Fatura (campo Terceiro)
  const terceirosMap = {};
  const addTerc = (nome, desc, valor, data) => {
    (terceirosMap[nome] = terceirosMap[nome]||{nome, total:0, itens:[]});
    terceirosMap[nome].total += valor||0;
    terceirosMap[nome].itens.push({desc, val:valor||0, data});
  };
  gastos.filter(p=>sel(p,"Categoria")==="Terceiros").forEach(p=>{
    const obs = txt(p,"Observação"); const m = obs.match(/Terceiro:\s*(.+)/i);
    addTerc(m?m[1].trim():"Outro", txt(p,"Descrição")||"?", num(p,"Valor")||0, dataGasto(p));
  });
  itensFat.filter(p=>txt(p,"Terceiro")).forEach(p=>{
    addTerc(txt(p,"Terceiro").trim(), (txt(p,"Compra")||"?")+" · "+txt(p,"Cartão"), num(p,"Valor")||0, (dateStart(p,"Data")||"").slice(0,10));
  });
  const terceiros = Object.values(terceirosMap).sort((a,b)=>b.total-a.total);
  const gastosMes = gastos.filter(p => dataGasto(p).slice(0,7) === anoMes && ehConsumo(p));
  const saidas = gastosMes.reduce((s,p)=> s + (num(p,"Valor")||0), 0);
  const sobra = renda - saidas;

  // conta investimentos separada; dividas parceladas separadas das contas
  const contaInvest = contas.find(p => txt(p,"Nome").toLowerCase().includes("investiment"));
  const ehDivida = p => /d[ií]vida|parcelad|empr[eé]st|financiament|fidc/i.test(txt(p,"Nome")+" "+sel(p,"Banco"));
  const contasCC = contas.filter(p => sel(p,"Tipo")==="Conta corrente" && !txt(p,"Nome").toLowerCase().includes("investiment") && !ehDivida(p));
  const dividas = contas.filter(p => sel(p,"Tipo")==="Conta corrente" && ehDivida(p));
  const cartoes = contas.filter(p => sel(p,"Tipo")==="Cartão de crédito");
  const totalContas = contasCC.reduce((s,p)=> s + (num(p,"Saldo atual")||0), 0);
  const totalFaturas = cartoes.reduce((s,p)=> s + (num(p,"Fatura atual")||0), 0);
  const totalDividas = dividas.reduce((s,p)=> s + (num(p,"Saldo atual")||0), 0);

  // saldo por titular (conta principal de cada um) pro destaque do topo
  const saldoPorTitular = (t) => contasCC.filter(p=>sel(p,"Titular")===t).reduce((s,p)=> s + (num(p,"Saldo atual")||0), 0);
  const saldoWes = saldoPorTitular("Wes");
  const saldoIara = saldoPorTitular("Iara");

  // gastos por categoria (mes)
  const catMap = {};
  gastosMes.forEach(p => { const c = sel(p,"Categoria") || "Outros"; catMap[c] = (catMap[c]||0) + (num(p,"Valor")||0); });
  const catsFull = Object.entries(catMap).map(([nome,val])=>({nome,val})).sort((a,b)=>b.val-a.val);
  const top5 = catsFull.slice(0,5).map(c=>({...c}));
  const outrosVal = catsFull.slice(5).reduce((s,c)=>s+c.val,0);
  if (outrosVal>0) top5.push({nome:"Outros+", val:outrosVal});

  // lancamentos detalhados por categoria (pra pagina interna)
  const lancPorCat = {};
  gastosMes.forEach(p => {
    const c = sel(p,"Categoria") || "Outros";
    (lancPorCat[c] = lancPorCat[c]||[]).push({ desc: txt(p,"Descrição")||"?", val: num(p,"Valor")||0, data: dataGasto(p) });
  });
  Object.values(lancPorCat).forEach(a=>a.sort((x,y)=>y.val-x.val));

  // lancamentos recentes (todos, mais novos primeiro) -> 3 na home, 3 dias na subpagina
  const d3 = new Date(Date.now()-3*864e5).toISOString().slice(0,10);
  const recentes = gastos.filter(ehConsumo).map(p=>({desc: txt(p,"Descrição")||"?", val: num(p,"Valor")||0, quem: sel(p,"Quem pagou"), cat: sel(p,"Categoria")||"Outros", data: dataGasto(p), _c: p.created_time||""}))
    .sort((a,b)=> (b.data+b._c).localeCompare(a.data+a._c));
  const ultimos = recentes.slice(0,3);
  const ultimos3d = recentes.filter(x => x.data >= d3);

  // aportes = gastos categoria Aporte/Investimento (entrada na conta invest)
  const aportes = gastos.filter(p => /aporte|investiment/i.test(sel(p,"Categoria")))
    .map(p=>({desc:txt(p,"Descrição")||"Aporte", val:num(p,"Valor")||0, data:dataGasto(p)}))
    .sort((a,b)=>(b.data||"").localeCompare(a.data||""));

  // tokens fortes pra casar gasto -> cartao (bandeira/banco/digitos)
  const norm = s => String(s||"").toLowerCase().replace(/mastercard|\bmc\b/g,"master").replace(/p[aã]o/g,"pao");
  const strongToks = s => [...new Set(norm(s).match(/visa|master|nubank|xp|gold|black|pao|7046|1009|5901|6047|6130/g)||[])];
  const gastosCartao = gastos.map(p=>({desc:txt(p,"Descrição")||"?", val:num(p,"Valor")||0, data:dataGasto(p), quem:sel(p,"Quem pagou"), toks: strongToks(sel(p,"Forma de pagamento")+" "+(txt(p,"Descrição")||""))}));
  // itens vindos da base Itens de Fatura (fonte principal do historico do cartao)
  const itensFatLista = itensFat.map(p=>({desc:txt(p,"Compra")||"?", val:num(p,"Valor")||0, data:(dateStart(p,"Data")||"").slice(0,10), cartao:txt(p,"Cartão")||"", parc:txt(p,"Parcela")||"", terceiro:txt(p,"Terceiro")||""}));
  const matchCart = (a,b) => { const ta=strongToks(a), tb=strongToks(b); return (a&&b&&a.trim().toLowerCase()===b.trim().toLowerCase()) || (ta.length&&tb.length&&ta.some(t=>tb.includes(t))); };
  const itensDoCartao = nomeCartao => {
    const daBase = itensFatLista.filter(x => x.cartao && matchCart(x.cartao, nomeCartao));
    if (daBase.length) return daBase.sort((a,b)=>(b.data||"").localeCompare(a.data||""));
    const ct = strongToks(nomeCartao); if(!ct.length) return [];
    return gastosCartao.filter(g=>g.toks.some(t=>ct.includes(t))).sort((a,b)=>(b.data||"").localeCompare(a.data||""));
  };

  // parcelados (compras em Nx / N/N / "parcela") pra aba Dividas
  const parcInfo = desc => { const m=desc.match(/\((\d+)\s*x\)/i); if(m) return m[1]+"x"; const n=desc.match(/\((\d+)\/(\d+)\)/); if(n) return n[1]+"/"+n[2]; if(/parcel/i.test(desc)) return "parcelado"; return null; };
  const parcelados = gastos.map(p=>({desc:txt(p,"Descrição")||"?", val:num(p,"Valor")||0, forma:sel(p,"Forma de pagamento"), quem:sel(p,"Quem pagou"), data:dataGasto(p), parc:parcInfo(txt(p,"Descrição")||"")}))
    .filter(x=>x.parc).sort((a,b)=>(b.data||"").localeCompare(a.data||""));

  return {
    anoMes, renda, saidas, sobra, investido, meta,
    contaInvest: contaInvest ? { nome:txt(contaInvest,"Nome"), saldo:num(contaInvest,"Saldo atual")||0 } : null,
    contasCC: contasCC.map(p=>({nome:txt(p,"Nome"), banco:sel(p,"Banco"), titular:sel(p,"Titular"), saldo:num(p,"Saldo atual"), situ:sel(p,"Situação"), obs:txt(p,"Observação")})),
    dividas: dividas.map(p=>({nome:txt(p,"Nome"), banco:sel(p,"Banco"), titular:sel(p,"Titular"), saldo:num(p,"Saldo atual"), obs:txt(p,"Observação")})),
    cartoes: cartoes.map(p=>({nome:txt(p,"Nome"), banco:sel(p,"Banco"), titular:sel(p,"Titular"), venc:txt(p,"Vencimento"), fatura:num(p,"Fatura atual"), limite:num(p,"Limite"), itens: itensDoCartao(txt(p,"Nome"))})),
    parcelados,
    totalContas, totalFaturas, totalDividas, top5, ultimos, ultimos3d, lancPorCat, aportes,
    saldoWes, saldoIara, terceiros,
    totalGasto: saidas,
  };
}

// ===== linha de foco =====
function foco(d) {
  const negativas = d.contasCC.filter(c => (c.saldo||0) < 0);
  if (negativas.length > 0) {
    const falta = Math.abs(negativas.reduce((s,c)=>s+(c.saldo||0),0));
    return { cor:"#f87171", txt:`Atenção: ${fmtFull(falta)} no vermelho. Prioridade é zerar isso.` };
  }
  if (d.renda > 0 && d.investido < d.meta) {
    const falta = d.meta - d.investido;
    return { cor:"#facc15", txt:`Faltam ${fmtFull(falta)} pra bater a meta de investimento do mês (10%).` };
  }
  if (d.sobra > 0) {
    return { cor:"#38bdf8", txt:`Mês saudável, sobra de ${fmtFull(d.sobra)}. Meta batida!` };
  }
  return { cor:"#facc15", txt:`Gastos passaram da renda esse mês. Revisem os maiores gastos.` };
}

// ===== rosca (grande) =====
const CORES = ["#38bdf8","#22d3ee","#818cf8","#c084fc","#5eead4","#f0abfc","#556085"];
function roscaGrande(cats, total) {
  if (!cats.length || total<=0) return `<div style="font-size:13px;color:#6b7a99;text-align:center;padding:30px;">sem gastos no mês ainda</div>`;
  let off = 0;
  const segs = cats.map((c,i)=>{
    const pct = (c.val/total)*100;
    const s = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${CORES[i%CORES.length]}" stroke-width="6.5" stroke-dasharray="${pct.toFixed(1)} 100" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 21 21)"/>`;
    off += pct; return s;
  }).join("");
  const leg = cats.map((c,i)=>`<div data-cat="${esc(c.nome)}" onclick="abreCat(this.dataset.cat)" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;">
    <span style="display:flex;align-items:center;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CORES[i%CORES.length]};margin-right:9px;"></span><span style="font-size:13.5px;color:#dbe3f0;">${esc(c.nome)}</span></span>
    <span style="display:flex;align-items:center;gap:8px;"><b style="font-size:13.5px;color:#eaf0fa;">${Math.round(c.val/total*100)}%</b><span style="color:#5a6785;font-size:15px;">›</span></span></div>`).join("");
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:18px;">
    <div style="position:relative;width:158px;height:158px;">
      <svg viewBox="0 0 42 42" style="width:100%;height:100%;"><circle cx="21" cy="21" r="15.9" fill="none" stroke="#141d33" stroke-width="6.5"/>${segs}</svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div style="font-size:24px;font-weight:800;color:#eaf0fa;">${fmt(total)}</div><div style="font-size:10px;color:#6b7a99;letter-spacing:.5px;">total no mês</div></div>
    </div>
    <div style="width:100%;">${leg}</div></div>`;
}

// ===== PAGINAS INTERNAS (renderizadas escondidas, SPA) =====
function pgInvestimentos(d) {
  const pct = d.meta>0 ? Math.min(100, Math.round(d.investido/d.meta*100)) : 0;
  const aportesHTML = d.aportes.length ? d.aportes.map(a=>`<div style="display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:15px;color:#dbe3f0;">${esc(a.desc)}${a.data?` <span style="color:#5a6785;font-size:13px;">${dataBR(a.data)}</span>`:""}</span><span style="font-size:15px;font-weight:700;color:#34d399;">${fmtFull(a.val)}</span></div>`).join("") : `<div style="font-size:14px;color:#6b7a99;padding:14px 0;">nenhum aporte registrado ainda</div>`;
  return `
    <div style="text-align:center;margin:8px 0 22px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Total investido</div>
      <div style="font-size:44px;font-weight:800;color:#eaf0fa;letter-spacing:-1.5px;margin-top:4px;">${fmtFull(d.contaInvest? d.contaInvest.saldo : d.investido)}</div>
    </div>
    <div style="background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:16px;padding:18px;margin-bottom:22px;">
      <div style="display:flex;justify-content:space-between;font-size:14px;color:#aab6cc;margin-bottom:10px;"><span>Meta do mês (10%)</span><span><b style="color:#38bdf8;">${pct}%</b> de ${fmtFull(d.meta)}</span></div>
      <div style="height:12px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#38bdf8,#22d3ee);border-radius:99px;"></div></div>
    </div>
    <div class="lbl">Histórico de aportes</div>
    <div>${aportesHTML}</div>`;
}
function pgContas(d) {
  const linhas = d.contasCC.map(c=>{
    const neg=(c.saldo||0)<0, cor=neg?"#f87171":"#34d399";
    return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:18px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div><div style="font-size:17px;font-weight:600;color:#eaf0fa;">${esc(c.nome)}</div><div style="font-size:13px;color:#6b7a99;margin-top:3px;">${esc(c.banco||"")}${c.titular?` · ${esc(c.titular)}`:""}</div></div>
        <div style="text-align:right;"><div style="font-size:22px;font-weight:800;color:${cor};">${fmtFull(c.saldo)}</div><div style="font-size:12px;color:${neg?'#f87171':'#34d399'};">${neg?'no vermelho':'no azul'}</div></div>
      </div>
      ${c.obs?`<div style="font-size:13px;color:#8a97b3;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.05);">${esc(c.obs)}</div>`:""}
    </div>`;
  }).join("") || `<div style="font-size:14px;color:#6b7a99;padding:14px 0;">nenhuma conta cadastrada ainda</div>`;
  return `<div style="text-align:center;margin:8px 0 20px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Total nas contas</div>
      <div style="font-size:40px;font-weight:800;color:${d.totalContas>=0?'#34d399':'#f87171'};letter-spacing:-1px;margin-top:4px;">${fmtFull(d.totalContas)}</div>
    </div>${linhas}`;
}
function pgCartoes(d) {
  const linhas = d.cartoes.map(c=>{
    const uso = (c.limite&&c.fatura!=null)? Math.min(100,Math.round(c.fatura/c.limite*100)) : null;
    return `<div data-cart="${esc(c.nome)}" onclick="abreCartao(this.dataset.cart)" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:18px;margin-bottom:12px;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${uso!=null?'14px':'0'};">
        <div><div style="font-size:17px;font-weight:600;color:#eaf0fa;">${esc(c.nome)} <span style="color:#5a6785;font-size:15px;">›</span></div><div style="font-size:13px;color:#6b7a99;margin-top:3px;">${c.venc?`vence ${esc(c.venc)}`:""}${c.titular?` · ${esc(c.titular)}`:""}</div></div>
        <div style="text-align:right;"><div style="font-size:22px;font-weight:800;color:#eaf0fa;">${c.fatura!=null?fmtFull(c.fatura):"-"}</div><div style="font-size:12px;color:#6b7a99;">fatura${c.limite?` · limite ${fmt(c.limite)}`:""}</div></div>
      </div>
      ${uso!=null?`<div style="height:8px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${uso}%;background:${uso>80?'#f87171':'linear-gradient(90deg,#818cf8,#c084fc)'};border-radius:99px;"></div></div>`:""}
    </div>`;
  }).join("") || `<div style="font-size:14px;color:#6b7a99;padding:14px 0;">nenhum cartão cadastrado ainda</div>`;
  return `<div style="text-align:center;margin:8px 0 20px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Total das faturas</div>
      <div style="font-size:40px;font-weight:800;color:#eaf0fa;letter-spacing:-1px;margin-top:4px;">${fmtFull(d.totalFaturas)}</div>
    </div>${linhas}`;
}
function pgDivida(d) {
  const negativas = d.contasCC.filter(c=>(c.saldo||0)<0);
  const parcelas = (d.dividas||[]).filter(c=>(c.saldo||0)<0);
  const dividaContas = Math.abs(negativas.reduce((s,c)=>s+(c.saldo||0),0));
  const dividaParcelas = Math.abs(parcelas.reduce((s,c)=>s+(c.saldo||0),0));
  const dividaTotal = dividaContas + dividaParcelas + d.totalFaturas;
  const passos = [
    ...negativas.map(c=>({nome:`Zerar ${c.nome}`, val:Math.abs(c.saldo||0)})),
    ...parcelas.map(c=>({nome:c.nome, val:Math.abs(c.saldo||0)})),
    ...d.cartoes.filter(c=>(c.fatura||0)>0).map(c=>({nome:`Fatura ${c.nome}`, val:c.fatura})),
  ].sort((a,b)=>a.val-b.val);
  const passosHTML = passos.length ? passos.map((p,i)=>`<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.05);">
    <div style="width:28px;height:28px;border-radius:50%;background:rgba(248,113,113,.15);color:#f87171;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">${i+1}</div>
    <span style="flex:1;font-size:15px;color:#dbe3f0;">${esc(p.nome)}</span>
    <span style="font-size:15px;font-weight:700;color:#f87171;">${fmtFull(p.val)}</span></div>`).join("") : `<div style="font-size:15px;color:#34d399;padding:20px 0;text-align:center;">Nada no vermelho. Parabéns! 🎉</div>`;
  return `<div style="text-align:center;margin:8px 0 22px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Dívida total</div>
      <div style="font-size:44px;font-weight:800;color:${dividaTotal>0?'#f87171':'#34d399'};letter-spacing:-1.5px;margin-top:4px;">${fmtFull(dividaTotal)}</div>
      <div style="font-size:13px;color:#6b7a99;margin-top:6px;">contas ${fmtFull(dividaContas)} · faturas ${fmtFull(d.totalFaturas)}${dividaParcelas>0?` · parcelas ${fmtFull(dividaParcelas)}`:""}</div>
    </div>
    <div class="lbl">Plano de quitação · do menor pro maior</div>
    <div>${passosHTML}</div>`;
}
function pgLancamentos(d) {
  const lista = d.ultimos3d || [];
  if (!lista.length) return `<div style="font-size:14px;color:#6b7a99;padding:20px 0;text-align:center;">sem lançamentos nos últimos 3 dias</div>`;
  const totalPer = lista.reduce((s,x)=>s+(x.val||0),0);
  // agrupa por dia
  const dias = {};
  lista.forEach(x => { (dias[x.data] = dias[x.data]||[]).push(x); });
  const ordem = Object.keys(dias).sort((a,b)=>b.localeCompare(a));
  const corpo = ordem.map(dia=>{
    const itens = dias[dia];
    const totDia = itens.reduce((s,x)=>s+(x.val||0),0);
    const linhas = itens.map(x=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05);">
      <span style="font-size:14.5px;color:#dbe3f0;">${esc(x.desc)}<br><span style="font-size:11.5px;color:#5a6785;">${esc(x.cat)}${x.quem?` · ${esc(x.quem)}`:""}</span></span>
      <span style="font-size:14.5px;font-weight:700;color:#eaf0fa;white-space:nowrap;">${fmt(x.val)}</span></div>`).join("");
    return `<div style="margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:12px;color:#7d8aa5;text-transform:uppercase;letter-spacing:.8px;font-weight:600;">${dataBR(dia)}</span>
        <span style="font-size:12px;color:#6b7a99;">${fmt(totDia)}</span></div>
      ${linhas}</div>`;
  }).join("");
  return `<div style="text-align:center;margin:8px 0 20px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Últimos 3 dias</div>
      <div style="font-size:36px;font-weight:800;color:#eaf0fa;letter-spacing:-1px;margin-top:4px;">${fmtFull(totalPer)}</div>
      <div style="font-size:13px;color:#6b7a99;margin-top:4px;">${lista.length} lançamento${lista.length!=1?'s':''}</div>
    </div>${corpo}`;
}

// ===== HTML principal =====
function html(d) {
  const f = foco(d);
  const pctMeta = d.meta>0 ? Math.min(100, Math.round(d.investido/d.meta*100)) : 0;
  const dash = 264, offset = dash - (dash*pctMeta/100);
  const posGeral = d.totalContas + (d.totalDividas||0) - d.totalFaturas;
  const hoje = new Date();
  const diaSem = hoje.toLocaleDateString("pt-BR",{weekday:"long"});
  const dataLonga = hoje.toLocaleDateString("pt-BR",{day:"2-digit",month:"long"});
  const hora = hoje.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});

  const contasHTML = d.contasCC.length ? d.contasCC.map((c,i)=>{
    const neg=(c.saldo||0)<0, cor=neg?"#f87171":"#34d399", badge=neg?"vermelho":"azul";
    const bg=neg?"rgba(248,113,113,.14)":"rgba(52,211,153,.13)";
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;${i<d.contasCC.length-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}">
      <span style="font-size:14px;color:#dbe3f0;">${esc(c.nome)}${c.banco?` · ${esc(c.banco)}`:""}</span>
      <span style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:700;color:${cor};">${fmt(c.saldo)}</span><span style="font-size:10px;background:${bg};color:${cor};padding:2px 9px;border-radius:99px;">${badge}</span></span></div>`;
  }).join("") : `<div style="font-size:13px;color:#6b7a99;padding:10px 0;">nenhuma conta cadastrada ainda</div>`;

  const cartoesHTML = d.cartoes.length ? d.cartoes.map((c,i)=>`<div data-cart="${esc(c.nome)}" onclick="event.stopPropagation();abreCartao(this.dataset.cart)" style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;cursor:pointer;${i<d.cartoes.length-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:13.5px;color:#aab6cc;">${esc(c.nome)}${c.venc?` · ${esc(c.venc)}`:""}</span><span style="display:flex;align-items:center;gap:7px;"><span style="font-size:13.5px;font-weight:600;color:#eaf0fa;">${c.fatura!=null?fmt(c.fatura):"-"}</span><span style="color:#5a6785;font-size:15px;">›</span></span></div>`).join("") : `<div style="font-size:13px;color:#6b7a99;padding:10px 0;">nenhum cartão com fatura ainda</div>`;

  const ultimosHTML = d.ultimos.length ? d.ultimos.map((g,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;${i<d.ultimos.length-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:13.5px;color:#dbe3f0;">${esc(g.desc)}${g.quem?` <span style="color:#5a6785;font-size:11.5px;">${esc(g.quem)}${g.data?` · ${dataBR(g.data)}`:""}</span>`:""}</span><span style="font-size:13.5px;font-weight:700;color:#eaf0fa;white-space:nowrap;">${fmt(g.val)}</span></div>`).join("") : `<div style="font-size:13px;color:#6b7a99;padding:10px 0;">sem gastos no mês</div>`;

  const itensDiv = [
    ...(d.dividas||[]).map(c=>({desc:c.nome, tag:c.banco||"empréstimo", val:Math.abs(c.saldo||0)})),
    ...(d.parcelados||[]).map(p=>({desc:p.desc, tag:p.parc, val:p.val})),
  ].sort((a,b)=>b.val-a.val);
  const linhaDiv = (c,i,n)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;${i<n-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:13.5px;color:#dbe3f0;">${esc(c.desc)}${c.tag?` <span style="color:#5a6785;font-size:11.5px;">${esc(c.tag)}</span>`:""}</span><span style="font-size:13.5px;font-weight:700;color:#f87171;white-space:nowrap;">${fmt(c.val)}</span></div>`;
  const dividasTop = itensDiv.slice(0,3);
  const dividasHTML = itensDiv.length ? dividasTop.map((c,i)=>linhaDiv(c,i,dividasTop.length)).join("") : "";
  const totalDiv = itensDiv.reduce((s,c)=>s+c.val,0);
  const dividasFullHTML = itensDiv.length ? `<div style="text-align:center;margin:8px 0 20px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Total parcelado + empréstimos</div>
      <div style="font-size:36px;font-weight:800;color:#f87171;letter-spacing:-1px;margin-top:4px;">${fmtFull(totalDiv)}</div>
      <div style="font-size:13px;color:#6b7a99;margin-top:4px;">${itensDiv.length} item${itensDiv.length!=1?'s':''}</div></div>
    ${itensDiv.map((c,i)=>linhaDiv(c,i,itensDiv.length)).join("")}` : `<div style="font-size:14px;color:#6b7a99;padding:14px 0;">nada parcelado.</div>`;

  // seção Terceiros (por pessoa) — gastos de outras pessoas no cartão do casal
  const terc = d.terceiros || [];
  const totalTerc = terc.reduce((s,t)=>s+t.total,0);
  const tercHTML = terc.length ? terc.map((t,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;${i<terc.length-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:14px;color:#dbe3f0;">${esc(t.nome)} <span style="color:#5a6785;font-size:11.5px;">${t.itens.length} lanç.</span></span><span style="font-size:14px;font-weight:700;color:#c084fc;white-space:nowrap;">${fmt(t.total)}</span></div>`).join("") : "";
  const tercFullHTML = terc.length ? `<div style="text-align:center;margin:8px 0 20px;">
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Total de terceiros (a cobrar)</div>
      <div style="font-size:36px;font-weight:800;color:#c084fc;letter-spacing:-1px;margin-top:4px;">${fmtFull(totalTerc)}</div>
      <div style="font-size:13px;color:#6b7a99;margin-top:4px;">não é gasto de vocês</div></div>
    ${terc.map(t=>`<div style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span style="font-size:15px;font-weight:700;color:#eaf0fa;">${esc(t.nome)}</span><span style="font-size:14px;font-weight:700;color:#c084fc;">${fmt(t.total)}</span></div>${t.itens.sort((a,b)=>b.val-a.val).map(x=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);"><span style="font-size:13px;color:#aab6cc;">${esc(x.desc)}${x.data?` <span style="color:#5a6785;font-size:11px;">${dataBR(x.data)}</span>`:""}</span><span style="font-size:13px;color:#dbe3f0;white-space:nowrap;">${fmt(x.val)}</span></div>`).join("")}</div>`).join("")}` : `<div style="font-size:14px;color:#6b7a99;padding:14px 0;">nenhum gasto de terceiro marcado ainda.</div>`;

  // dados de categoria pro JS (pagina interna)
  const catJSON = JSON.stringify(Object.fromEntries(Object.entries(d.lancPorCat).map(([k,v])=>[k,v])));
  // dados de cartao pro JS (historico da fatura)
  const cardJSON = JSON.stringify(Object.fromEntries(d.cartoes.map(c=>[c.nome, {fatura:c.fatura, venc:c.venc, limite:c.limite, itens:(c.itens||[]).map(x=>({desc:x.desc, val:x.val, data:x.data, terc:x.terceiro||""}))}])));

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="WI Finance">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMxYjNhNmIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwYTBlMWEiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4MCIgcng9IjQyIiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iOTAiIHk9IjExOCIgZm9udC1zaXplPSI2NCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXdlaWdodD0iODAwIiBmaWxsPSIjMzhiZGY4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5XSTwvdGV4dD48L3N2Zz4=">
<title>WI Finance</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:#05070d;font-family:'Outfit',system-ui,sans-serif;min-height:100vh;padding:16px}
.wrap{max-width:460px;margin:0 auto}
.card{background:radial-gradient(120% 80% at 50% 0%,#141d33,#0a0e1a 62%);border-radius:22px;padding:18px;border:1px solid rgba(56,189,248,.2);box-shadow:0 24px 70px rgba(0,0,0,.55)}
.lbl{font-size:11px;color:#7d8aa5;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;font-weight:600}
.click{cursor:pointer;transition:transform .12s,border-color .12s}
.click:active{transform:scale(.985)}
.chev{color:#5a6785;font-size:19px;font-weight:400}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.pg{animation:rise .35s ease both}
.hidden{display:none}
.back{display:flex;align-items:center;gap:8px;color:#7d8aa5;font-size:15px;margin-bottom:20px;cursor:pointer;font-weight:500}
.logo{width:52px;height:52px;border-radius:15px;background:linear-gradient(145deg,#1b3a6b,#0a0e1a);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:19px;color:#38bdf8;box-shadow:0 0 22px rgba(56,189,248,.3);border:1px solid rgba(56,189,248,.3);letter-spacing:1px}
</style></head>
<body><div class="wrap"><div class="card">

<!-- ===== HOME ===== -->
<div id="home" class="pg">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="logo.png?v=${Date.now()}" alt="WI" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(56,189,248,.4);box-shadow:0 0 14px rgba(56,189,248,.25);">
      <div><div style="font-size:18px;font-weight:800;color:#eaf0fa;letter-spacing:-.2px;">WI Finance</div><div style="font-size:11px;color:#6b7a99;margin-top:1px;text-transform:capitalize;">${diaSem}, ${dataLonga} · ${hora}</div></div>
    </div>
    <div style="position:relative;width:38px;height:38px;flex-shrink:0;" title="meta de investimento do mes">
      <svg viewBox="0 0 100 100" style="width:100%;height:100%;transform:rotate(-90deg);"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(56,189,248,.12)" stroke-width="11"/><circle cx="50" cy="50" r="42" fill="none" stroke="#38bdf8" stroke-width="11" stroke-linecap="round" stroke-dasharray="${dash}" stroke-dashoffset="${offset}"/></svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#38bdf8;">${pctMeta}%</div>
    </div>
  </div>

  <div class="click" onclick="abre('contas')" style="background:linear-gradient(150deg,rgba(56,189,248,.13),rgba(34,211,238,.03));border:1px solid rgba(56,189,248,.22);border-radius:18px;padding:18px;margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div style="font-size:11px;color:#7d8aa5;letter-spacing:.8px;text-transform:uppercase;">Saldo do casal</div>
      <span class="chev">›</span>
    </div>
    <div style="font-size:clamp(26px,8vw,34px);font-weight:800;letter-spacing:-1px;line-height:1.05;color:${d.totalContas>=0?'#34d399':'#f87171'};margin-top:2px;white-space:nowrap;">${fmtFull(d.totalContas)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
      <div style="background:rgba(0,0,0,.22);border-radius:12px;padding:12px;">
        <div style="font-size:11px;color:#8a97b3;text-transform:uppercase;letter-spacing:.5px;">Wes</div>
        <div style="font-size:19px;font-weight:800;margin-top:3px;color:${d.saldoWes>=0?'#34d399':'#f87171'};">${fmt(d.saldoWes)}</div>
      </div>
      <div style="background:rgba(0,0,0,.22);border-radius:12px;padding:12px;">
        <div style="font-size:11px;color:#8a97b3;text-transform:uppercase;letter-spacing:.5px;">Iara</div>
        <div style="font-size:19px;font-weight:800;margin-top:3px;color:${d.saldoIara>=0?'#34d399':'#f87171'};">${fmt(d.saldoIara)}</div>
      </div>
    </div>
  </div>

  <div class="click" onclick="abre('invest')" style="background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.15);border-radius:12px;padding:13px 16px;margin-bottom:9px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:12px;color:#7d8aa5;text-transform:uppercase;letter-spacing:.6px;">Investimentos</span>
    <span style="display:flex;align-items:center;gap:8px;flex-shrink:0;"><span style="font-size:16px;font-weight:800;color:#38bdf8;white-space:nowrap;">${fmtFull(d.contaInvest?d.contaInvest.saldo:d.investido)}</span><span class="chev">›</span></span>
  </div>

  <div class="click" onclick="abre('divida')" style="background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.15);border-radius:12px;padding:13px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
    <span style="font-size:12px;color:#7d8aa5;text-transform:uppercase;letter-spacing:.6px;">Dívida total</span>
    <span style="display:flex;align-items:center;gap:8px;flex-shrink:0;"><span style="font-size:17px;font-weight:800;color:${posGeral>=0?'#34d399':'#f87171'};white-space:nowrap;">${fmtFull(posGeral)}</span><span class="chev">›</span></span>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Entrou no mês</div><div style="font-size:18px;font-weight:800;margin-top:3px;color:#eaf0fa;">${fmt(d.renda)}</div></div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Saiu no mês</div><div style="font-size:18px;font-weight:800;margin-top:3px;color:#eaf0fa;">${fmt(d.saidas)}</div></div>
  </div>

  <div class="lbl">Contas correntes</div>
  <div class="click" onclick="abre('contas')" style="margin-bottom:18px;">${contasHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;margin-top:8px;">ver detalhes <span class="chev">›</span></div></div>

  <div class="lbl">Cartões · faturas</div>
  <div class="click" onclick="abre('cartoes')" style="margin-bottom:18px;">${cartoesHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;margin-top:8px;">ver detalhes <span class="chev">›</span></div></div>

  ${dividasHTML ? `<div class="lbl">Dívidas · empréstimos</div>
  <div class="click" onclick="abre('dividas')" style="background:rgba(248,113,113,.05);border:1px solid rgba(248,113,113,.12);border-radius:14px;padding:6px 14px;margin-bottom:18px;">${dividasHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;padding:8px 0 4px;">ver todos <span class="chev">›</span></div></div>` : ""}

  ${tercHTML ? `<div class="lbl">Terceiros · a cobrar</div>
  <div class="click" onclick="abre('terceiros')" style="background:rgba(192,132,252,.05);border:1px solid rgba(192,132,252,.15);border-radius:14px;padding:6px 14px;margin-bottom:18px;">${tercHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;padding:8px 0 4px;">ver detalhes <span class="chev">›</span></div></div>` : ""}

  <div class="lbl">Gastos do mês por categoria</div>
  <div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:18px;padding:18px 16px;margin-bottom:18px;">${roscaGrande(d.top5, d.totalGasto)}</div>

  <div class="lbl">Últimos lançamentos</div>
  <div class="click" onclick="abre('lancamentos')" style="margin-bottom:18px;">${ultimosHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;margin-top:8px;">ver todos <span class="chev">›</span></div></div>

  <div style="display:flex;align-items:center;gap:11px;background:${f.cor}14;border:1px solid ${f.cor}38;border-radius:12px;padding:13px 15px;">
    <span style="width:10px;height:10px;border-radius:50%;background:${f.cor};flex-shrink:0;box-shadow:0 0 8px ${f.cor};"></span>
    <span style="font-size:13px;color:#cfe4f5;line-height:1.45;">${f.txt}</span>
  </div>
</div>

<!-- ===== SUBPAGINAS ===== -->
<div id="invest" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Investimentos</div>${pgInvestimentos(d)}</div>
<div id="contas" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Contas correntes</div>${pgContas(d)}</div>
<div id="cartoes" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Cartões</div>${pgCartoes(d)}</div>
<div id="divida" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Dívida & quitação</div>${pgDivida(d)}</div>
<div id="lancamentos" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Lançamentos</div>${pgLancamentos(d)}</div>
<div id="dividas" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Dívidas & parcelados</div>${dividasFullHTML}</div>
<div id="terceiros" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;">Terceiros · a cobrar</div>${tercFullHTML}</div>
<div id="categoria" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;" id="catTit">Categoria</div><div id="catBody"></div></div>
<div id="cartaodet" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;" id="cardTit">Cartão</div><div id="cardBody"></div></div>

</div>
<div style="text-align:center;font-size:11px;color:#3a4560;margin-top:16px;letter-spacing:2px;">WI FINANCE · PAINEL DO CASAL</div>
</div>

<script>
var CATS = ${catJSON};
var CARDS = ${cardJSON};
var pags = ["home","invest","contas","cartoes","divida","categoria","lancamentos","cartaodet","dividas","terceiros"];
function show(id){ pags.forEach(function(p){ document.getElementById(p).classList.add("hidden"); }); var e=document.getElementById(id); e.classList.remove("hidden"); e.style.animation="none"; e.offsetHeight; e.style.animation=""; window.scrollTo(0,0); }
function abre(id){ show(id); }
function volta(){ show("home"); }
function fnum(v){ var s=v<0?"-":""; v=Math.abs(v); return v>=1000?(s+"R$ "+(v/1000).toFixed(v>=10000?0:1).replace(".",",")+"k"):(s+"R$ "+Math.round(v)); }
function abreCat(nome){
  var l = CATS[nome]||[];
  var total = l.reduce(function(s,x){return s+x.val;},0);
  document.getElementById("catTit").textContent = nome;
  var head = '<div style="text-align:center;margin:8px 0 20px;"><div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Total em '+nome+'</div><div style="font-size:40px;font-weight:800;color:#eaf0fa;letter-spacing:-1px;margin-top:4px;">'+fnum(total)+'</div><div style="font-size:13px;color:#6b7a99;margin-top:4px;">'+l.length+' lançamento'+(l.length!=1?'s':'')+' no mês</div></div>';
  var body = l.length? l.map(function(x){ return '<div style="display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:15px;color:#dbe3f0;">'+x.desc+(x.data?' <span style=\\'color:#5a6785;font-size:13px;\\'>'+(x.data?x.data.slice(8,10)+"/"+x.data.slice(5,7):"")+'</span>':'')+'</span><span style="font-size:15px;font-weight:700;color:#eaf0fa;">'+fnum(x.val)+'</span></div>'; }).join("") : '<div style="font-size:14px;color:#6b7a99;padding:14px 0;">sem lançamentos</div>';
  document.getElementById("catBody").innerHTML = head + body;
  show("categoria");
}
function abreCartao(nome){
  var c = CARDS[nome]||{itens:[]};
  var itens = c.itens||[];
  var somaItens = itens.reduce(function(s,x){return s+x.val;},0);
  var tercTot = itens.reduce(function(s,x){return s+(x.terc?x.val:0);},0);
  var iaraTot = somaItens - tercTot;
  document.getElementById("cardTit").textContent = nome;
  var head = '<div style="text-align:center;margin:8px 0 18px;"><div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Fatura atual</div><div style="font-size:38px;font-weight:800;color:#eaf0fa;letter-spacing:-1px;margin-top:4px;">'+(c.fatura!=null?fnum(c.fatura):"-")+'</div><div style="font-size:13px;color:#6b7a99;margin-top:4px;">'+(c.venc?"vence "+c.venc:"")+(c.limite?" · limite "+fnum(c.limite):"")+'</div></div>';
  if(tercTot>0){ head += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;"><div style="background:rgba(255,255,255,.03);border-radius:12px;padding:12px;"><div style="font-size:11px;color:#6b7a99;text-transform:uppercase;">Detectado do casal</div><div style="font-size:18px;font-weight:800;color:#34d399;margin-top:3px;">'+fnum(iaraTot)+'</div></div><div style="background:rgba(192,132,252,.08);border-radius:12px;padding:12px;"><div style="font-size:11px;color:#6b7a99;text-transform:uppercase;">De terceiros</div><div style="font-size:18px;font-weight:800;color:#c084fc;margin-top:3px;">'+fnum(tercTot)+'</div></div></div>'; }
  var lbl = '<div style="font-size:11px;color:#7d8aa5;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;font-weight:600;">Compras neste cartão</div>';
  var body = itens.length? itens.map(function(x){ var tag=x.terc?' <span style=\\'color:#c084fc;font-size:11px;\\'>'+x.terc+'</span>':''; return '<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:14.5px;color:#dbe3f0;">'+x.desc+tag+(x.data?' <span style=\\'color:#5a6785;font-size:12px;\\'>'+(x.data.slice(8,10)+"/"+x.data.slice(5,7))+'</span>':'')+'</span><span style="font-size:14.5px;font-weight:700;color:'+(x.terc?"#c084fc":"#eaf0fa")+';white-space:nowrap;">'+fnum(x.val)+'</span></div>'; }).join("") : '<div style="font-size:13.5px;color:#6b7a99;padding:14px 0;">ainda sem compras detalhadas deste cartão. O total da fatura acima é o oficial.</div>';
  var rodape = itens.length? '<div style="display:flex;justify-content:space-between;padding:12px 2px 0;font-size:12px;color:#6b7a99;"><span>compras listadas</span><span>'+fnum(somaItens)+'</span></div>' : "";
  document.getElementById("cardBody").innerHTML = head + lbl + body + rodape;
  show("cartaodet");
}
</script>
</body></html>`;
}

// ===== publica no GitHub =====
async function publicar(conteudo) {
  const api = `https://api.github.com/repos/${REPO}/contents/index.html`;
  let sha;
  const g = await fetch(`${api}?ref=main`, { headers: { Authorization:`Bearer ${GH}`, "User-Agent":"financas" } });
  if (g.ok) { const j = await g.json(); sha = j.sha; }
  const r = await fetch(api, {
    method: "PUT",
    headers: { Authorization:`Bearer ${GH}`, "User-Agent":"financas", "Content-Type":"application/json" },
    body: JSON.stringify({
      message: `painel ${new Date().toISOString().slice(0,16)}`,
      content: Buffer.from(conteudo,"utf8").toString("base64"),
      branch: "main",
      ...(sha ? { sha } : {}),
    }),
  });
  return r.status;
}

// ===== main =====
(async () => {
  const d = await coletar();
  const page = html(d);
  if (DRY) {
    console.log("=== DRY (nao publica) ===");
    console.log("Mes:", d.anoMes, "| Renda:", d.renda, "| Saidas:", d.saidas, "| Sobra:", d.sobra);
    console.log("Investido:", d.investido, "| Meta:", d.meta);
    console.log("Contas:", d.contasCC.length, "| Cartoes:", d.cartoes.length, "| Categorias:", d.top5.length);
    console.log("Total contas:", d.totalContas, "| Total faturas:", d.totalFaturas);
    writeFileSync("/tmp/painel.html", page);
    console.log("HTML salvo em /tmp/painel.html (", page.length, "bytes )");
    return;
  }
  const status = await publicar(page);
  console.log(status === 200 || status === 201 ? "PUBLICADO OK ("+status+")" : "ERRO publicar: "+status);
})().catch(e => { console.error("FALHOU:", e.message); process.exit(1); });
