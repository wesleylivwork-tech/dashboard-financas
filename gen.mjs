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

// ===== CONFIG ORCAMENTO (WI Finance v2) =====
// Renda de referencia = media real do casal (nao a do mes pontual). Limite do teto.
const RENDA_REF = 18000;

// mapa: categoria antiga (micro) -> macro. Fallback quando o gasto nao tem campo Macro.
const CAT2MACRO = {
  "Mercado":"Alimentacao","Padaria":"Alimentacao","Restaurante/Lanche":"Alimentacao","Conveniência":"Alimentacao","Conveniencia":"Alimentacao",
  "Combustível":"Carro","Combustivel":"Carro","Transporte/Pedágio":"Carro","Carro":"Carro",
  "Casa/Moradia":"Moradia","Assinaturas":"Moradia",
  "Saúde/Farmácia":"Saude","Saude/Farmacia":"Saude",
  "Educação":"Pessoal","Compras":"Pessoal","Estética":"Pessoal","Estetica":"Pessoal",
  "Lazer":"Lazer","Pet":"Pet","Outros":"Outros",
  "Dívida":"Divida","Divida":"Divida","Taxas":"Taxas","Transferência":"Transferencia","Transferencia":"Transferencia","Terceiros":"Terceiros","Item Fatura":"ItemFatura","Duplicado":"Duplicado","Investimento":"Investimento","Aporte":"Investimento",
};
// classe padrao por categoria (Essencial/Luxo). fluxo fica sem classe.
const CAT2CLASSE = {
  "Mercado":"Essencial","Padaria":"Luxo","Restaurante/Lanche":"Luxo","Conveniência":"Luxo","Conveniencia":"Luxo",
  "Combustível":"Essencial","Combustivel":"Essencial","Transporte/Pedágio":"Essencial","Carro":"Essencial",
  "Casa/Moradia":"Essencial","Assinaturas":"Luxo",
  "Saúde/Farmácia":"Essencial","Saude/Farmacia":"Essencial",
  "Educação":"Essencial","Compras":"Luxo","Estética":"Luxo","Estetica":"Luxo",
  "Lazer":"Luxo","Pet":"Essencial","Outros":"Essencial",
};
// overrides por regex na descricao (macro / classe / micro / flags). Aplicados apos o mapa.
// {re, macro?, classe?, micro?, divida?, ignora?}
const OVERRIDES = [
  { re:/claude\s*max|claude/i, macro:"Trabalho", classe:null, ignora:false, micro:"Ferramenta trabalho" },
  { re:/cons[óo]rcio|embracon/i, macro:"Carro", classe:"Essencial", micro:"Consórcio", divida:true },
  { re:/vitor|lavagem/i, macro:"Carro", classe:"Luxo", micro:"Lavagem" },
  { re:/\bpersonal\b|\bt[êe]nis\b|\bjorge\b|\btuba\b|open tenis|\bclube\b/i, macro:"Pessoal", classe:"Luxo", micro:"Esporte" },
  { re:/cabeleireiro|\bsal[ãa]o\b|\bvagner\b|\bunhas?\b|sobrancelha|manicure/i, macro:"Pessoal", classe:"Luxo", micro:"Estética" },
  { re:/viagem|seattle/i, macro:"Viagem", classe:"Luxo", micro:"Viagem" },
  { re:/apple|icloud|ifood|polo play/i, macro:"Pessoal", classe:"Luxo", micro:"Assinatura pessoal" },
  { re:/lavagem sof[áa]|conserto|ferro de passar|aliexpress|ralador|casad/i, macro:"Casa", classe:"Essencial", micro:"Casa reparos & itens" },
  { re:/fatech|correios|pix empresa|pix gabriel|f[áa]bio rog/i, ignora:true },
];
// ===== DICIONARIO DE ESTABELECIMENTOS (v1, 21/08/2026) =====
// Nome do lugar -> macro / classe / micro. VENCE o que o robo escreveu no Notion.
// Cada linha foi confirmada por CNPJ na web ou pelo nome completo no app do Itau.
// Pra corrigir um lugar em TODOS os lancamentos de uma vez, edite AQUI, nao no Notion.
// Nao se aplica a Terceiros, Divida, Transferencia, Investimento, Item Fatura e Duplicado.
const DICIONARIO = [
  // mercado de verdade
  { re:/savegnago|sumerbol|covabra|\bsonda\b|pao de a[cç]ucar|supermercado pagu|supermercado restaura|elieudo/i, macro:"Alimentacao", classe:"Essencial", micro:"Mercado" },
  // padaria
  { re:/gianini|panificadora|panific|gerbeli/i, macro:"Alimentacao", classe:"Luxo", micro:"Padaria e confeitaria" },
  // conveniencia de posto e adega
  { re:/recreio ouro|ora pois|vmt.{0,2}quick|rr vinhos|garcia bersanet/i, macro:"Alimentacao", classe:"Luxo", micro:"Conveniencia" },
  // restaurante, lanche e delivery
  { re:/meu sushi|rezende restaurante|restaurantetomate|restaurante tomate|katatau|me gusta|salgadosdidi|mc.?donald|axolotl|jrl hamburgueria|pizzaria|cm de sousa|salgaderia/i, macro:"Alimentacao", classe:"Luxo", micro:"Restaurante" },
  // estetica e barbearia
  { re:/wolk barber|blue skin|oboticario/i, macro:"Pessoal", classe:"Luxo", micro:"Estetica" },
  // carro
  { re:/auto posto|comercial de comb|posto indiana|fox rodas|thorck|chavao auto/i, macro:"Carro", classe:"Essencial", micro:"Combustivel e pecas" },
  { re:/sem parar|viamonaco/i, macro:"Carro", classe:"Essencial", micro:"Pedagio" },
  { re:/uber/i, macro:"Carro", classe:"Essencial", micro:"Transporte" },
  // lazer
  { re:/hopi hari|eventim/i, macro:"Lazer", classe:"Luxo", micro:"Passeio" },
  // casa
  { re:/flamar embalagens/i, macro:"Casa", classe:"Luxo", micro:"Utensilios" },
  // moradia
  { re:/arganet/i, macro:"Moradia", classe:"Essencial", micro:"Internet" },
  { re:/conta vivo|app vivo|celulares/i, macro:"Moradia", classe:"Essencial", micro:"Celular" },
  // trabalho
  { re:/hostinger|z-api|anthropic|claude max/i, macro:"Trabalho", classe:"Essencial", micro:"Ferramenta trabalho" },
  // pet
  { re:/petlove|bicos e focinhos|hospital veter/i, macro:"Pet", classe:"Essencial", micro:"Pet" },
];
function noDicionario(desc, lugar){
  const alvo = String(desc||"") + " " + String(lugar||"");
  for (const d of DICIONARIO) if (d.re.test(alvo)) return d;
  return null;
}
function classifica(cat, desc){
  let macro = CAT2MACRO[cat] || "Outros";
  let classe = CAT2CLASSE[cat] || null;
  let micro = cat || "Outros";
  let divida = false, ignora = false;
  for (const o of OVERRIDES){ if (o.re.test(desc||"")){ if(o.macro)macro=o.macro; if(o.classe!==undefined&&o.classe!==null)classe=o.classe; if(o.micro)micro=o.micro; if(o.divida)divida=true; if(o.ignora)ignora=true; break; } }
  return { macro, classe, micro, divida, ignora };
}
// tetos por macro (limite mensal). renda-ref 18k -> app mostra estouro.
const TETOS = {
  Moradia:4528, Casa:500, Alimentacao:3000, Carro:6244, Saude:1450,
  Pessoal:3550, Lazer:400, Viagem:1000, Pet:500, Trabalho:700, Outros:200,
};
// macros que sao consumo (entram em essencial/luxo e barrinhas)
const MACROS_CONSUMO = ["Moradia","Casa","Alimentacao","Carro","Saude","Pessoal","Lazer","Viagem","Pet","Trabalho","Outros"];
const MACRO_ICON = { Moradia:"🏠", Casa:"🔧", Alimentacao:"🍽️", Carro:"🚗", Saude:"❤️", Pessoal:"👤", Lazer:"🎉", Viagem:"✈️", Pet:"🐾", Trabalho:"💼", Outros:"📦" };

// ===== canonizacao de macro (o Notion grava com acento, o codigo trabalha sem) =====
const semAc = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const MACRO_CANON = {};
["Moradia","Casa","Alimentacao","Carro","Saude","Pessoal","Lazer","Viagem","Pet","Trabalho","Outros",
 "Divida","Taxas","Transferencia","Terceiros","ItemFatura","Duplicado","Investimento"]
  .forEach(m => { MACRO_CANON[semAc(m).toLowerCase()] = m; });
const canonMacro = m => MACRO_CANON[semAc(m).toLowerCase().replace(/\s+/g,"")] || (m||"Outros");

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
  // renda SEMPRE do mes corrente. se nao existir linha do mes, nao herda do mes passado.
  const mesRef = mensal.find(p => txt(p,"Ano-Mês") === anoMes) || null;
  const renda = mesRef ? (num(mesRef,"Renda") || 0) : 0;
  const rendaPendente = !mesRef || renda <= 0;
  const investido = mesRef ? (num(mesRef,"Investido") || 0) : 0;
  const meta = (renda > 0 ? renda : RENDA_REF) * 0.1;

  // data do gasto: usa campo Data se existir, senao created_time
  const dataGasto = p => (dateStart(p,"Data") || p.created_time || "").slice(0,10);
  // categorias que NAO sao consumo do casal (nao entram no "Saiu no mes" nem na rosca)
  // trava dura: essas categorias NUNCA sao consumo do casal, nao importa o que a descricao diga
  const NAO_CONSUMO = ["Transferência","Transferencia","Dívida","Divida","Terceiros","Item Fatura","Duplicado","Investimento","Aporte"];
  // classifica um gasto em macro/classe/micro: usa campo Macro se preenchido, senao deriva da Categoria+Descricao
  const macroDe = p => {
    const cat = sel(p,"Categoria");
    // 1) DICIONARIO DE ESTABELECIMENTOS vence, menos nas categorias que nao sao consumo
    if (!NAO_CONSUMO.includes(cat)) {
      const d = noDicionario(txt(p,"Descrição"), txt(p,"Lugar"));
      if (d) return { macro:canonMacro(d.macro), classe:d.classe, micro:d.micro, divida:false, ignora:false };
    }
    // 2) campo Macro do Notion
    const m = sel(p,"Macro");
    if (m) return { macro:canonMacro(m), classe:sel(p,"Classe")||CAT2CLASSE[cat]||null, micro:cat||m, divida:false, ignora:false };
    // 3) deriva da Categoria + Descricao
    const c = classifica(cat, txt(p,"Descrição"));
    return { ...c, macro:canonMacro(c.macro) };
  };
  const ehConsumo = p => {
    if (NAO_CONSUMO.includes(sel(p,"Categoria"))) return false;
    const c = macroDe(p); return MACROS_CONSUMO.includes(c.macro) && !c.ignora;
  };
  // terceiros (gasto de outra pessoa no cartao do casal) agrupado por nome
  // fontes: base de Gastos (categoria Terceiros) + base Itens de Fatura (campo Terceiro)
  const terceirosMap = {};
  const addTerc = (nome, desc, valor, data) => {
    (terceirosMap[nome] = terceirosMap[nome]||{nome, total:0, itens:[]});
    terceirosMap[nome].total += valor||0;
    terceirosMap[nome].itens.push({desc, val:valor||0, data});
  };
  // "a cobrar" = lancamentos Terceiros DO MES corrente, em valor positivo.
  // o robo grava "Reembolso: NOME" (ou "Terceiro: NOME") na observacao e o valor negativo.
  // QUITADO sai da conta; "SALDO RESTANTE: R$x" manda no lugar do valor cheio.
  gastos.filter(p=>sel(p,"Categoria")==="Terceiros" && dataGasto(p).slice(0,7)===anoMes).forEach(p=>{
    const obs = txt(p,"Observação");
    if (/quitado/i.test(obs)) return;
    const m = obs.match(/(?:reembolso|terceiro)\s*:\s*([^\-\n(]+)/i);
    const nome = (m ? m[1] : "Nao identificado").trim().replace(/\s+/g," ");
    const ms = obs.match(/SALDO RESTANTE:\s*R?\$?\s*([\d.]+,\d{2}|\d+)/i);
    const val = ms ? parseFloat(ms[1].replace(/\./g,"").replace(",",".")) : Math.abs(num(p,"Valor")||0);
    addTerc(nome, txt(p,"Descrição")||"?", val, dataGasto(p));
  });
  const terceiros = Object.values(terceirosMap).sort((a,b)=>b.total-a.total);
  const gastosMes = gastos.filter(p => dataGasto(p).slice(0,7) === anoMes && ehConsumo(p));
  const saidas = gastosMes.reduce((s,p)=> s + (num(p,"Valor")||0), 0);
  const sobra = renda - saidas;
  // fixo vs variavel (do campo Tipo)
  const fixoMes = gastosMes.filter(p=>/fix/i.test(sel(p,"Tipo"))).reduce((s,p)=>s+(num(p,"Valor")||0),0);
  const varMes = saidas - fixoMes;

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

  // ===== v2: agrupamento por MACRO + essencial/luxo + tetos + comparativo =====
  const macroMap = {}; let essencialTot=0, luxoTot=0; const lancPorMacro={};
  gastosMes.forEach(p => {
    const c = macroDe(p); const v = num(p,"Valor")||0;
    macroMap[c.macro] = (macroMap[c.macro]||0) + v;
    if (c.classe==="Essencial") essencialTot+=v; else if (c.classe==="Luxo") luxoTot+=v;
    (lancPorMacro[c.macro]=lancPorMacro[c.macro]||[]).push({desc:txt(p,"Descrição")||"?", val:v, data:dataGasto(p), micro:c.micro, classe:c.classe||"-"});
  });
  Object.values(lancPorMacro).forEach(a=>a.sort((x,y)=>y.val-x.val));
  const macros = MACROS_CONSUMO.map(m=>({macro:m, icon:MACRO_ICON[m]||"", uso:macroMap[m]||0, teto:TETOS[m]||0}))
    .filter(x=>x.uso>0 || x.teto>0).sort((a,b)=>b.uso-a.uso);
  const tetoTotal = Object.values(TETOS).reduce((s,v)=>s+v,0);
  // comparativo mes anterior: MESMO PERIODO (dia 1 ate o dia de hoje), pra nao comparar 6 dias com um mes inteiro
  const [ay,am] = anoMes.split("-").map(Number);
  const prev = new Date(ay, am-2, 1);
  const anoMesAnt = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}`;
  const diaHoje = hoje.getDate();
  const gastosAnt = gastos.filter(p=>dataGasto(p).slice(0,7)===anoMesAnt && ehConsumo(p));
  const saidasAntMes = gastosAnt.reduce((s,p)=>s+(num(p,"Valor")||0),0);
  const saidasAnt = gastosAnt.filter(p=>Number(dataGasto(p).slice(8,10))<=diaHoje).reduce((s,p)=>s+(num(p,"Valor")||0),0);
  // saida de caixa: consumo + parcelas de divida pagas no mes (divida nao e consumo, mas sai do bolso)
  const pagoDivida = gastos.filter(p=>dataGasto(p).slice(0,7)===anoMes && macroDe(p).macro==="Divida").reduce((s,p)=>s+(num(p,"Valor")||0),0);
  const saiuDoBolso = saidas + pagoDivida;

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
  const tokDiv = dividas.map(p => (txt(p,"Nome")||"").toLowerCase().split(/[\s\-,.]+/).filter(w=>w.length>=4)[0]).filter(Boolean);
  const jaEhDivida = desc => tokDiv.some(t => String(desc||"").toLowerCase().includes(t));
  const parcelados = gastos
    .filter(p => dataGasto(p).slice(0,7)===anoMes)
    .filter(p => { const c=sel(p,"Categoria"); return !NAO_CONSUMO.includes(c) || /d[ií]vida/i.test(c); })
    .filter(p => !jaEhDivida(txt(p,"Descrição")))
    .map(p => {
      const desc=txt(p,"Descrição")||"?", val=num(p,"Valor")||0, parc=parcInfo(desc);
      const m=String(parc||"").match(/^(\d+)\/(\d+)$/);
      const faltam = m ? Math.max(0,(+m[2])-(+m[1])) : null;
      return {desc, val, parcela:val, faltam, saldo: faltam!=null ? val*faltam : val,
              forma:sel(p,"Forma de pagamento"), quem:sel(p,"Quem pagou"), data:dataGasto(p), parc};
    })
    .filter(x => x.parc && x.val>0).sort((a,b)=>b.saldo-a.saldo);

  // frescor: data do extrato mais antigo entre as contas correntes
  const datasAtu = contasCC.map(p=>dateStart(p,"Atualizado em")).filter(Boolean).sort();
  const atuMaisVelha = datasAtu[0] || "";
  const diasAtraso = atuMaisVelha ? Math.round((hoje - new Date(atuMaisVelha+"T12:00:00"))/864e5) : null;
  // divida do casal: bruta menos o que terceiros devem (esta dentro das faturas)
  const tercTotal = terceiros.reduce((s,t)=>s+t.total,0);
  const dividaBruta = Math.abs(contasCC.filter(p=>(num(p,"Saldo atual")||0)<0).reduce((s,p)=>s+(num(p,"Saldo atual")||0),0))
    + Math.abs(totalDividas) + totalFaturas;
  const dividaLiquida = dividaBruta - tercTotal;
  // faturas vencendo nos proximos 5 dias
  const venceEm = c => { const m=String(txt(c,"Vencimento")||"").match(/(\d{1,2})/); if(!m) return null;
    const dia=+m[1]; let d=new Date(hoje.getFullYear(),hoje.getMonth(),dia);
    if (d < new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate())) d=new Date(hoje.getFullYear(),hoje.getMonth()+1,dia);
    return { dia, faltam: Math.round((d-new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate()))/864e5) }; };
  const vencendo = cartoes.map(c=>{ const v=venceEm(c); return v&&v.faltam<=5 ? {nome:txt(c,"Nome"), dia:v.dia, faltam:v.faltam, valor:num(c,"Fatura atual")||0} : null; })
    .filter(x=>x&&x.valor>0).sort((a,b)=>a.faltam-b.faltam);

  return {
    anoMes, renda, rendaPendente, saidas, sobra, investido, meta,
    pagoDivida, saiuDoBolso, tercTotal, dividaBruta, dividaLiquida, atuMaisVelha, diasAtraso, vencendo, saidasAntMes, diaHoje,
    contaInvest: contaInvest ? { nome:txt(contaInvest,"Nome"), saldo:num(contaInvest,"Saldo atual")||0 } : null,
    contasCC: contasCC.map(p=>({nome:txt(p,"Nome"), banco:sel(p,"Banco"), titular:sel(p,"Titular"), saldo:num(p,"Saldo atual"), situ:sel(p,"Situação"), obs:txt(p,"Observação"), atu:dateStart(p,"Atualizado em")})),
    dividas: dividas.map(p=>({nome:txt(p,"Nome"), banco:sel(p,"Banco"), titular:sel(p,"Titular"), saldo:num(p,"Saldo atual"), obs:txt(p,"Observação"), pagas:num(p,"Parcelas pagas"), totais:num(p,"Parcelas totais"), quita:dateStart(p,"Quita em")})),
    cartoes: cartoes.map(p=>({nome:txt(p,"Nome"), banco:sel(p,"Banco"), titular:sel(p,"Titular"), venc:txt(p,"Vencimento"), fatura:num(p,"Fatura atual"), limite:num(p,"Limite"), itens: itensDoCartao(txt(p,"Nome"))})),
    parcelados,
    totalContas, totalFaturas, totalDividas, top5, ultimos, ultimos3d, lancPorCat, aportes,
    saldoWes, saldoIara, terceiros, fixoMes, varMes,
    totalGasto: saidas,
    macros, tetoTotal, essencialTot, luxoTot, rendaRef: RENDA_REF, saidasAnt, anoMesAnt, lancPorMacro,
  };
}

// ===== linha de foco =====
function foco(d) {
  const negativas = d.contasCC.filter(c => (c.saldo||0) < 0);
  if (negativas.length > 0) {
    const falta = Math.abs(negativas.reduce((s,c)=>s+(c.saldo||0),0));
    return { cor:"#f87171", txt:`Atenção: ${fmtFull(falta)} no vermelho. Prioridade é zerar isso.` };
  }
  if (d.investido < d.meta) {
    const falta = d.meta - d.investido;
    return { cor:"#facc15", txt:`Faltam ${fmtFull(falta)} pra bater a meta de investimento do mês (10%).` };
  }
  if (!d.rendaPendente && d.sobra > 0) {
    return { cor:"#38bdf8", txt:`Mês saudável, sobra de ${fmtFull(d.sobra)}. Meta batida!` };
  }
  if (d.rendaPendente) {
    return { cor:"#38bdf8", txt:`Renda do mês ainda não apurada. Os gastos já estão contando.` };
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
  const dividaTotal = d.dividaLiquida;
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
      <div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">Dívida do casal</div>
      <div style="font-size:44px;font-weight:800;color:${dividaTotal>0?'#f87171':'#34d399'};letter-spacing:-1.5px;margin-top:4px;">${fmtFull(dividaTotal)}</div>
      <div style="font-size:13px;color:#6b7a99;margin-top:6px;">contas ${fmtFull(dividaContas)} · faturas ${fmtFull(d.totalFaturas)}${dividaParcelas>0?` · parcelas ${fmtFull(dividaParcelas)}`:""}</div>
      ${d.tercTotal>0?`<div style="font-size:13px;color:#c084fc;margin-top:4px;">menos ${fmtFull(d.tercTotal)} de terceiros dentro das faturas</div>`:""}
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

// ===== v2 componentes (essencial/luxo, barras por macro, comparativo) =====
function blocoEssLuxo(d){
  const ess=d.essencialTot||0, lux=d.luxoTot||0, tot=ess+lux||1;
  const pe=Math.round(ess/tot*100), pl=100-pe;
  return `<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:16px;padding:16px;margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
      <div><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Essencial</div><div style="font-size:21px;font-weight:800;color:#34d399;">${fmt(ess)}</div></div>
      <div style="text-align:right;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Luxo</div><div style="font-size:21px;font-weight:800;color:#f0abfc;">${fmt(lux)}</div></div>
    </div>
    <div style="display:flex;height:10px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.05);">
      <div style="width:${pe}%;background:#34d399;"></div><div style="width:${pl}%;background:#f0abfc;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#7d8aa5;"><span>${pe}% essencial</span><span>${pl}% luxo</span></div>
  </div>`;
}
function barrasMacro(d){
  return (d.macros||[]).map(m=>{
    const pct = m.teto>0? Math.round(m.uso/m.teto*100) : 0;
    const estouro = m.uso>m.teto && m.teto>0;
    const cor = estouro? "#f87171" : pct>85? "#facc15" : "linear-gradient(90deg,#38bdf8,#22d3ee)";
    return `<div data-macro="${esc(m.macro)}" onclick="abreMacro(this.dataset.macro)" style="padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:13.5px;color:#dbe3f0;">${m.icon} ${esc(m.macro)}</span>
        <span style="font-size:12.5px;color:${estouro?'#f87171':'#aab6cc'};">${fmt(m.uso)} <span style="color:#5a6785;">/ ${fmt(m.teto)}</span> <span class="chev">›</span></span>
      </div>
      <div style="height:7px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${Math.min(100,pct)}%;background:${cor};border-radius:99px;"></div></div>
    </div>`;
  }).join("");
}
function blocoComparativo(d){
  const at=d.saidas||0, ant=d.saidasAnt||0;
  // compara o MESMO periodo do mes passado (dia 1 ate hoje). sem isso, 6 dias vs mes inteiro = falsa melhora.
  const temBase = ant>0;
  const dif=at-ant;
  const seta = dif>0?"▲":dif<0?"▼":"=";  const cor=dif>0?"#f87171":"#34d399";
  const sub = temBase ? `<span style="color:${cor};font-weight:700;">${seta} ${fmtFull(Math.abs(dif))}</span> <span style="color:#6b7a99;">vs dia ${d.diaHoje} do mês passado</span>` : `<span style="color:#6b7a99;">sem base do mês passado pra comparar</span>`;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;">
      <div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Renda referência</div>
      <div style="font-size:18px;font-weight:800;margin-top:3px;color:#eaf0fa;">${fmtFull(d.rendaRef)}</div>
      <div style="font-size:10.5px;color:#6b7a99;margin-top:2px;">média do casal</div>
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;">
      <div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Consumo até hoje</div>
      <div style="font-size:18px;font-weight:800;margin-top:3px;color:#eaf0fa;">${fmtFull(at)}</div>
      <div style="font-size:10.5px;margin-top:2px;">${sub}</div>
    </div>
  </div>`;
}
function avisoTeto(d){
  const teto=d.tetoTotal||0, ref=d.rendaRef||0;
  if (teto<=ref) return "";
  const excesso=teto-ref;
  return `<div style="display:flex;align-items:center;gap:11px;background:rgba(248,113,113,.09);border:1px solid rgba(248,113,113,.28);border-radius:12px;padding:12px 14px;margin-bottom:14px;">
    <span style="font-size:18px;">⚠️</span>
    <span style="font-size:12.5px;color:#f4c7c7;line-height:1.45;">Os tetos somam <b>${fmt(teto)}</b>, ${fmt(excesso)} acima da renda média (${fmt(ref)}). O essencial cabe; o alvo é cortar luxo pra fechar a conta.</span>
  </div>`;
}
function pgMacro(d){ return ""; } // renderizado via JS (abreMacro)

// rosca por MACRO com barrinha uso/teto embutida na legenda (5 principais + ver mais)
function roscaMacros(d){
  const macros = (d.macros||[]).filter(m=>m.uso>0);
  const total = macros.reduce((s,m)=>s+m.uso,0);
  if(!macros.length||total<=0) return `<div style="font-size:13px;color:#6b7a99;text-align:center;padding:30px;">sem gastos no mês ainda</div>`;
  let off=0;
  const segs = macros.map((m,i)=>{
    const pct=(m.uso/total)*100;
    const s=`<circle cx="21" cy="21" r="15.9" fill="none" stroke="${CORES[i%CORES.length]}" stroke-width="6.5" stroke-dasharray="${pct.toFixed(1)} 100" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 21 21)"/>`;
    off+=pct; return s;
  }).join("");
  const linha = (m,i)=>{
    const pctTot=Math.round(m.uso/total*100);
    const pctTeto=m.teto>0?Math.round(m.uso/m.teto*100):0;
    const estouro=m.uso>m.teto&&m.teto>0;
    const cor=estouro?"#f87171":pctTeto>85?"#facc15":"linear-gradient(90deg,#38bdf8,#22d3ee)";
    return `<div data-macro="${esc(m.macro)}" onclick="abreMacro(this.dataset.macro)" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="display:flex;align-items:center;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CORES[i%CORES.length]};margin-right:9px;flex-shrink:0;"></span><span style="font-size:13.5px;color:#dbe3f0;">${m.icon} ${esc(m.macro)}</span></span>
        <span style="display:flex;align-items:center;gap:7px;"><b style="font-size:13px;color:#eaf0fa;">${pctTot}%</b><span style="font-size:10.5px;color:${estouro?'#f87171':'#6b7a99'};white-space:nowrap;">${fmt(m.uso)}/${fmt(m.teto)}</span><span style="color:#5a6785;font-size:14px;">›</span></span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;"><div style="height:100%;width:${Math.min(100,pctTeto)}%;background:${cor};border-radius:99px;"></div></div>
    </div>`;
  };
  const top5=macros.slice(0,5).map((m,i)=>linha(m,i)).join("");
  const resto=macros.slice(5).map((m,i)=>linha(m,i+5)).join("");
  const verMais = resto? `<div id="maisMac" style="display:none;">${resto}</div><div onclick="var e=document.getElementById('maisMac');var v=e.style.display==='none';e.style.display=v?'block':'none';this.innerText=v?'ver menos ▲':'ver mais ▼';" style="text-align:center;color:#7d8aa5;font-size:12px;padding:11px 0 3px;cursor:pointer;font-weight:600;">ver mais ▼</div>` : "";
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:18px;">
    <div style="position:relative;width:158px;height:158px;">
      <svg viewBox="0 0 42 42" style="width:100%;height:100%;"><circle cx="21" cy="21" r="15.9" fill="none" stroke="#141d33" stroke-width="6.5"/>${segs}</svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div style="font-size:24px;font-weight:800;color:#eaf0fa;">${fmt(total)}</div><div style="font-size:10px;color:#6b7a99;letter-spacing:.5px;">total no mês</div></div>
    </div>
    <div style="width:100%;">${top5}${verMais}</div></div>`;
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

  const cardsOrd = [...d.cartoes].sort((a,b)=>(b.fatura||0)-(a.fatura||0));
  const cardLinha = (c,ult)=>`<div data-cart="${esc(c.nome)}" onclick="event.stopPropagation();abreCartao(this.dataset.cart)" style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;cursor:pointer;${!ult?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:13.5px;color:#aab6cc;">${esc(c.nome)}${c.venc?` · ${esc(c.venc)}`:""}</span><span style="display:flex;align-items:center;gap:7px;"><span style="font-size:13.5px;font-weight:600;color:#eaf0fa;">${c.fatura!=null?fmt(c.fatura):"-"}</span><span style="color:#5a6785;font-size:15px;">›</span></span></div>`;
  const cards3 = cardsOrd.slice(0,3), cardsResto = cardsOrd.slice(3);
  const cartoesHTML = d.cartoes.length ? (
    cards3.map((c,i)=>cardLinha(c,false)).join("") +
    (cardsResto.length ? `<div id="maisCards" style="display:none;">${cardsResto.map((c,i)=>cardLinha(c,i===cardsResto.length-1)).join("")}</div><div onclick="event.stopPropagation();var e=document.getElementById('maisCards');var v=e.style.display==='none';e.style.display=v?'block':'none';this.innerText=v?'ver menos ▲':'ver mais ▼';" style="text-align:center;color:#7d8aa5;font-size:12px;padding:10px 0 2px;cursor:pointer;font-weight:600;">ver mais ▼</div>` : "")
  ) : `<div style="font-size:13px;color:#6b7a99;padding:10px 0;">nenhum cartão com fatura ainda</div>`;

  // faixa de vencimento proximo (fatura em ate 5 dias)
  const venceHTML = (d.vencendo||[]).length ? `<div style="background:rgba(250,204,21,.09);border:1px solid rgba(250,204,21,.3);border-radius:12px;padding:12px 14px;margin-bottom:14px;">
    ${d.vencendo.map(v=>`<div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:#f5e0a3;">
      <span>⏰ ${esc(v.nome)} vence dia ${String(v.dia).padStart(2,"0")}${v.faltam===0?" (hoje)":v.faltam===1?" (amanhã)":` (em ${v.faltam} dias)`}</span>
      <b style="white-space:nowrap;">${fmtFull(v.valor)}</b></div>`).join("")}
  </div>` : "";

  const ultimosHTML = d.ultimos.length ? d.ultimos.map((g,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;${i<d.ultimos.length-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:13.5px;color:#dbe3f0;">${esc(g.desc)}${g.quem?` <span style="color:#5a6785;font-size:11.5px;">${esc(g.quem)}${g.data?` · ${dataBR(g.data)}`:""}</span>`:""}</span><span style="font-size:13.5px;font-weight:700;color:#eaf0fa;white-space:nowrap;">${fmt(g.val)}</span></div>`).join("") : `<div style="font-size:13px;color:#6b7a99;padding:10px 0;">sem gastos no mês</div>`;

  // prazo de quitação a partir do padrão de parcela "N/M"
  const prazoQuit = parc => {
    const m = String(parc||"").match(/(\d+)\s*\/\s*(\d+)/);
    if(!m) return "";
    const faltam = (+m[2]) - (+m[1]);
    if(faltam<=0) return "última parcela";
    const fim = new Date(hoje.getFullYear(), hoje.getMonth()+faltam, 1);
    return `faltam ${faltam} · acaba ${fim.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}).replace(".","")}`;
  };
  const mesBR = dt => dt.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}).replace(".","");
  const prazoDivida = c => {
    const bits=[];
    if(c.pagas!=null && c.totais!=null) bits.push(`faltam ${Math.max(0,c.totais-c.pagas)} de ${c.totais}`);
    else if(c.pagas!=null) bits.push(`${c.pagas} pagas`);
    if(c.quita) bits.push(`acaba ${mesBR(new Date(c.quita+"T12:00:00"))}`);
    return bits.join(" · ");
  };
  const itensDiv = [
    ...(d.dividas||[]).map(c=>({desc:c.nome, tag:(c.pagas!=null&&c.totais!=null)?`${c.pagas}ª de ${c.totais}`:(c.banco||"empréstimo"), val:Math.abs(c.saldo||0), prazo:prazoDivida(c)})),
    ...(d.parcelados||[]).map(p=>({desc:p.desc, tag:p.parc, val:p.saldo, prazo:[prazoQuit(p.parc), (p.faltam!=null&&p.faltam>0)?`${fmt(p.parcela)}/mês`:""].filter(Boolean).join(" · ")})),
  ].sort((a,b)=>b.val-a.val);
  const linhaDiv = (c,i,n)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;${i<n-1?'border-bottom:1px solid rgba(255,255,255,.05);':''}"><span style="font-size:13.5px;color:#dbe3f0;">${esc(c.desc)}${c.tag?` <span style="color:#5a6785;font-size:11.5px;">${esc(c.tag)}</span>`:""}${c.prazo?`<br><span style="color:#5eead4;font-size:11px;">${c.prazo}</span>`:""}</span><span style="font-size:13.5px;font-weight:700;color:#f87171;white-space:nowrap;">${fmt(c.val)}</span></div>`;
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
  const macroJSON = JSON.stringify(Object.fromEntries((d.macros||[]).map(m=>[m.macro, {uso:m.uso, teto:m.teto, itens:(d.lancPorMacro[m.macro]||[])}])));

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
    ${d.atuMaisVelha?`<div style="font-size:11px;margin-top:5px;color:${d.diasAtraso>7?'#facc15':'#6b7a99'};">extrato de ${dataBR(d.atuMaisVelha)}${d.diasAtraso>7?` · ${d.diasAtraso} dias atrás, vale atualizar`:""}</div>`:""}
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
    <span style="font-size:12px;color:#7d8aa5;text-transform:uppercase;letter-spacing:.6px;">Dívida do casal</span>
    <span style="display:flex;align-items:center;gap:8px;flex-shrink:0;"><span style="font-size:17px;font-weight:800;color:#f87171;white-space:nowrap;">${fmtFull(d.dividaLiquida)}</span><span class="chev">›</span></span>
  </div>
  ${d.tercTotal>0?`<div style="font-size:11px;color:#6b7a99;margin:-8px 2px 14px;">bruto ${fmtFull(d.dividaBruta)} menos ${fmtFull(d.tercTotal)} que terceiros devem</div>`:""}

  ${venceHTML}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Entrou no mês</div><div style="font-size:18px;font-weight:800;margin-top:3px;color:${d.rendaPendente?'#7d8aa5':'#eaf0fa'};">${d.rendaPendente?"a apurar":fmt(d.renda)}</div></div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Consumo no mês</div><div style="font-size:18px;font-weight:800;margin-top:3px;color:#eaf0fa;">${fmtFull(d.saidas)}</div>${d.pagoDivida>0?`<div style="font-size:10px;color:#6b7a99;margin-top:2px;">+ ${fmtFull(d.pagoDivida)} de dívida = ${fmtFull(d.saiuDoBolso)} do bolso</div>`:""}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
    <div style="background:rgba(255,255,255,.02);border-radius:12px;padding:11px;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Fixo</div><div style="font-size:16px;font-weight:700;margin-top:2px;color:#818cf8;">${fmt(d.fixoMes||0)}</div></div>
    <div style="background:rgba(255,255,255,.02);border-radius:12px;padding:11px;"><div style="font-size:10px;color:#6b7a99;text-transform:uppercase;letter-spacing:.6px;">Variável</div><div style="font-size:16px;font-weight:700;margin-top:2px;color:#5eead4;">${fmt(d.varMes||0)}</div></div>
  </div>

  <div class="lbl">Orçamento do mês</div>
  ${avisoTeto(d)}
  ${blocoComparativo(d)}
  ${blocoEssLuxo(d)}

  <div class="lbl">Contas correntes</div>
  <div class="click" onclick="abre('contas')" style="margin-bottom:18px;">${contasHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;margin-top:8px;">ver detalhes <span class="chev">›</span></div></div>

  <div class="lbl">Cartões · faturas</div>
  <div style="margin-bottom:18px;">${cartoesHTML}</div>

  ${dividasHTML ? `<div class="lbl">Dívidas · empréstimos</div>
  <div class="click" onclick="abre('dividas')" style="background:rgba(248,113,113,.05);border:1px solid rgba(248,113,113,.12);border-radius:14px;padding:6px 14px;margin-bottom:18px;">${dividasHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;padding:8px 0 4px;">ver todos <span class="chev">›</span></div></div>` : ""}

  ${tercHTML ? `<div class="lbl">Terceiros · a cobrar</div>
  <div class="click" onclick="abre('terceiros')" style="background:rgba(192,132,252,.05);border:1px solid rgba(192,132,252,.15);border-radius:14px;padding:6px 14px;margin-bottom:18px;">${tercHTML}
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:5px;color:#5a6785;font-size:12px;padding:8px 0 4px;">ver detalhes <span class="chev">›</span></div></div>` : ""}

  <div class="lbl">Gastos do mês por área · uso vs teto</div>
  <div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:18px;padding:18px 16px;margin-bottom:18px;">${roscaMacros(d)}</div>

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
<div id="macrodet" class="pg hidden"><div class="back" onclick="volta()">‹ Voltar</div><div class="lbl" style="margin-bottom:2px;" id="macroTit">Área</div><div id="macroBody"></div></div>

</div>
<div style="text-align:center;font-size:11px;color:#3a4560;margin-top:16px;letter-spacing:2px;">WI FINANCE · PAINEL DO CASAL</div>
</div>

<script>
var CATS = ${catJSON};
var CARDS = ${cardJSON};
var MACROS = ${macroJSON};
var pags = ["home","invest","contas","cartoes","divida","categoria","lancamentos","cartaodet","dividas","terceiros","macrodet"];
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
function abreMacro(nome){
  var m = MACROS[nome]||{itens:[],uso:0,teto:0};
  var itens = m.itens||[];
  var estouro = m.uso>m.teto && m.teto>0;
  document.getElementById("macroTit").textContent = nome;
  var pct = m.teto>0? Math.round(m.uso/m.teto*100):0;
  var head = '<div style="text-align:center;margin:8px 0 16px;"><div style="font-size:13px;color:#7d8aa5;letter-spacing:1px;text-transform:uppercase;">'+nome+'</div><div style="font-size:38px;font-weight:800;color:'+(estouro?"#f87171":"#eaf0fa")+';letter-spacing:-1px;margin-top:4px;">'+fnum(m.uso)+'</div><div style="font-size:13px;color:#6b7a99;margin-top:4px;">teto '+fnum(m.teto)+' · '+pct+'% usado</div></div>';
  head += '<div style="height:9px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;margin-bottom:18px;"><div style="height:100%;width:'+Math.min(100,pct)+'%;background:'+(estouro?"#f87171":"linear-gradient(90deg,#38bdf8,#22d3ee)")+';border-radius:99px;"></div></div>';
  var lbl = '<div style="font-size:11px;color:#7d8aa5;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;font-weight:600;">Lançamentos do mês</div>';
  var body = itens.length? itens.map(function(x){ var tag=x.classe&&x.classe!="-"?' <span style=\\'font-size:10px;color:'+(x.classe=="Luxo"?"#f0abfc":"#34d399")+';\\'>'+x.classe+'</span>':''; return '<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:14.5px;color:#dbe3f0;">'+x.desc+tag+'<br><span style=\\'font-size:11px;color:#5a6785;\\'>'+(x.micro||"")+(x.data?' · '+(x.data.slice(8,10)+"/"+x.data.slice(5,7)):"")+'</span></span><span style="font-size:14.5px;font-weight:700;color:#eaf0fa;white-space:nowrap;">'+fnum(x.val)+'</span></div>'; }).join("") : '<div style="font-size:14px;color:#6b7a99;padding:14px 0;">sem lançamentos no mês</div>';
  document.getElementById("macroBody").innerHTML = head + lbl + body;
  show("macrodet");
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
