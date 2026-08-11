#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Patch V6 do bot WI Finance (bot-iara)
# 1) junta mensagens em rajada (uma resposta so)
# 2) espera 9s de silencio antes de processar o lote
# 3) regras novas de interpretacao, cartao oficial, confirmacao de gravacao
# 4) CLAUDE.md: nomes oficiais de cartao + secao FATOS
# Idempotente: marca "(V6)"

import io, os, re, shutil, sys, time

BOT = "/root/bot-iara/bot.mjs"
CMD = "/root/bot-iara/CLAUDE.md"

def read(p):
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()

def write(p, s):
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(s)

# ---------------- bot.mjs ----------------
s = read(BOT)
if "(V6)" in s:
    print("bot.mjs ja tem V6, pulando")
else:
    shutil.copy(BOT, BOT + ".bak_v6_" + str(int(time.time())))
    orig = s

    # A) buffer de textos por chat, declarado junto do mapa de sessoes
    m = re.search(r"^(const sessoes = .*)$", s, re.M)
    if not m:
        print("ERRO: nao achei 'const sessoes ='"); sys.exit(1)
    s = s[:m.end(1)] + "\nconst bufTxt = {}; // (V6) junta mensagens em rajada" + s[m.end(1):]

    # B) espera 9s de silencio depois de receber um lote
    m = re.search(r"const upd = await tg\(\s*\"getUpdates\"[^\n]*\n\s*if\s*\(\s*!upd\.result\s*\)\s*continue;", s)
    if not m:
        print("ERRO: nao achei o bloco getUpdates/continue"); sys.exit(1)
    espera = (
        "\n        // (V6) espera o casal terminar de digitar antes de processar\n"
        "        if (upd.result.length) {\n"
        "          await new Promise(s2 => setTimeout(s2, 9000));\n"
        "          try {\n"
        "            const u2 = await tg(\"getUpdates\", { offset, timeout: 0 });\n"
        "            if (u2 && u2.result && u2.result.length > upd.result.length) upd.result = u2.result;\n"
        "          } catch (e) {}\n"
        "        }"
    )
    s = s[:m.end()] + espera + s[m.end():]

    # C) indice da ultima mensagem de texto de cada chat no lote
    m = re.search(r"^(\s*)const ultGrupo = \{\};[^\n]*$", s, re.M)
    if not m:
        print("ERRO: nao achei 'const ultGrupo'"); sys.exit(1)
    ind = m.group(1)
    ultTxt = ("\n" + ind + "const ultTxt = {}; // (V6) ultima msg de texto de cada chat no lote\n"
              + ind + "upd.result.forEach((x2, i2) => { const m2 = x2.message; "
              "if (m2 && m2.chat && m2.text && !m2.photo && !m2.document) ultTxt[m2.chat.id] = i2; });")
    s = s[:m.end()] + ultTxt + s[m.end():]

    # D) junta os textos: so responde na ultima mensagem do chat naquele lote
    m = re.search(r"^(\s*)const g = msg\.media_group_id;", s, re.M)
    if not m:
        print("ERRO: nao achei 'const g = msg.media_group_id'"); sys.exit(1)
    ind = m.group(1)
    junta = (
        ind + "// (V6) rajada de texto: acumula e responde uma vez so\n"
        + ind + "if (!_img && !msg.media_group_id) {\n"
        + ind + "  if (ultTxt[chatId] !== i) { bufTxt[chatId] = (bufTxt[chatId] || []).concat(_raw); continue; }\n"
        + ind + "  if (bufTxt[chatId] && bufTxt[chatId].length) { _raw = bufTxt[chatId].concat(_raw).join(\"\\n\"); bufTxt[chatId] = []; }\n"
        + ind + "}\n"
    )
    s = s[:m.start()] + junta + s[m.start():]

    # E) regras novas no fim do prompt SISTEMA
    linhas = s.split("\n")
    alvo = -1
    for idx, ln in enumerate(linhas):
        if ln.startswith("REGRAS ADICIONAIS:"):
            alvo = idx
            break
    if alvo < 0:
        print("ERRO: nao achei a linha REGRAS ADICIONAIS"); sys.exit(1)
    ln = linhas[alvo]
    pos = ln.rfind("`")
    if pos < 0:
        print("ERRO: nao achei o fim do template do SISTEMA"); sys.exit(1)

    NOVAS = (
        " (V6) REGRAS NOVAS, VALEM ACIMA DAS ANTERIORES: "
        "(V6-1) RAJADA: o casal manda varias mensagens seguidas e voce recebe todas juntas, separadas por quebra de linha. "
        "Leia TODAS antes de responder e responda UMA vez so, cobrindo tudo. Nunca responda a primeira e depois a segunda. "
        "(V6-2) CARTAO SO COM NOME OFICIAL: antes de gravar gasto no credito, consulte a BASE 2 e use no campo Forma de pagamento "
        "EXATAMENTE o campo Nome de la. Nomes oficiais: 'Pão de Açúcar - Iara', 'Nubank - Iara', 'Latam Visa - Iara', "
        "'Mastercard Itaú - Iara', 'XP - Wes', 'Itaú Gold - Wes', 'Adicional do Wes (final 1009)'. O campo 'Como falam' da BASE 2 "
        "traz os apelidos do casal. NUNCA invente variacao, NUNCA escreva sem acento, NUNCA crie opcao nova no select. "
        "Se a mensagem nao deixar claro o cartao, pergunte usando os nomes oficiais. "
        "(V6-3) CONFIRME A GRAVACAO: depois de criar ou atualizar pagina, releia a pagina e so entao diga que lancou. "
        "Se a releitura falhar, diga claramente que NAO gravou. Nunca diga feito por suposicao e nunca culpe o Notion. "
        "(V6-4) FATO DITO E VERDADE E VIRA REGISTRO NA HORA: quando o casal disser algo que muda dinheiro no futuro (valor que vai sair, "
        "quem vai pagar, data combinada, parcelamento), grave na mesma hora na secao FATOS do CLAUDE.md com a data, e na base quando couber. "
        "Nunca dependa da memoria da conversa. Se a pessoa disser 'eu te avisei', ela avisou: procure em FATOS antes de contestar. "
        "(V6-5) INTERPRETACAO: antes de perguntar, procure a resposta nesta ordem: 1) CLAUDE.md, 2) as bases do Notion, 3) a conversa. "
        "So pergunte o que nao existe em nenhum dos tres. No maximo 3 perguntas por vez e sempre com sua melhor hipotese junto, "
        "no formato 'entendi que e X, confirma?'. Estabelecimento ja explicado uma vez nunca mais se pergunta. "
        "(V6-6) NUNCA INVENTE LANCAMENTO: so cite item que voce leu de fato, com data e valor exatos. Sem certeza da linha, diga que nao achou. "
        "(V6-7) SALDO E NUMERO VIVO: o saldo mora na BASE 2 (Saldo atual + Atualizado em). Atualize esse campo a cada movimento. "
        "Ao responderem sobre saldo, leia a base, some so o que entrou depois de 'Atualizado em' e de UM numero. "
        "Nunca de duas estimativas diferentes na mesma conversa. "
        "(V6-8) PERGUNTA JA RESPONDIDA: se ja foi respondida em qualquer momento, mesmo com outras palavras, nao repita. "
        "Se voce perguntou e nao houve resposta, cobre uma unica vez, listando o que falta. "
    )
    linhas[alvo] = ln[:pos] + NOVAS + ln[pos:]
    s = "\n".join(linhas)

    write(BOT, s)
    print("bot.mjs patchado. antes=%d depois=%d" % (len(orig), len(s)))

# ---------------- CLAUDE.md ----------------
c = read(CMD)
if "(V6)" in c:
    print("CLAUDE.md ja tem V6, pulando")
else:
    shutil.copy(CMD, CMD + ".bak_v6_" + str(int(time.time())))
    trocas = [
        ("Cartão Iara Itaú (dia 08)", "Pão de Açúcar - Iara"),
        ("Cartao Iara Itau (dia 08)", "Pão de Açúcar - Iara"),
        ("Cartão Iara Nubank (dia 08)", "Nubank - Iara"),
        ("Cartao Iara Nubank (dia 08)", "Nubank - Iara"),
        ("Cartão Iara Visa (dia 20)", "Latam Visa - Iara"),
        ("Cartao Iara Visa (dia 20)", "Latam Visa - Iara"),
        ("Cartão Iara Master (dia 20)", "Mastercard Itaú - Iara"),
        ("Cartao Iara Master (dia 20)", "Mastercard Itaú - Iara"),
        ("Cartão XP (dia 05)", "XP - Wes"),
        ("Cartão Itau Gold 7046 - Wes", "Itaú Gold - Wes"),
    ]
    for a, b in trocas:
        c = c.replace(a, b)

    c += u"""

## (V6) NOMES OFICIAIS DE CARTAO - unica fonte
No campo Forma de pagamento da BASE 1 escreva EXATAMENTE um destes, com acento:
- Pão de Açúcar - Iara   (fecha dia 01, vence dia 08. Apelidos: dia 05, dia 08, itau, pao de acucar, pda, black)
- Nubank - Iara          (fecha dia 01, vence dia 08. Apelidos: nubank, nu)
- Latam Visa - Iara      (fecha dia 14, vence dia 20. Apelidos: visa, latam, latampass)
- Mastercard Itaú - Iara (fecha dia 14, vence dia 20. Apelidos: master, mastercard)
- XP - Wes               (vence dia 05)
- Itaú Gold - Wes        (vence dia 17. Apelidos: gold, 7046)
- Adicional do Wes (final 1009)  (entra na fatura do Pão de Açúcar - Iara)
- Porto Seguro - Iara    (so debita o seguro, quase nunca usa)
Fora do credito: Débito, Pix, Dinheiro, Boleto. Sempre com acento.
Proibido criar nome novo, abreviar, tirar acento ou usar apelido no campo. Na duvida, pergunte pelo nome oficial.

## (V6) FATOS - o que o casal ja explicou (leia ANTES de perguntar)
- 10/08: a Iara avisou que o juros do cheque especial (R$ 744,88) sairia da conta dela naquele dia. Saiu. Quem paga e a Fatech, dia 20, junto com o IOF de 102,11 (total 846,99).
- 11/08: Yago quitou R$ 1.082,63 (cartao Itau 782,04 + Nubank 185,59 + emprestimo 115,00).
- Os 20,00 (25/07) e 50,00 (26/07) de "Mercado via Yago" NAO abatem nada do Yago.
- Seguro do apartamento Itau: R$ 20,36, debitado na conta da Iara todo mes.
- RedBull comprado pelo colega Rafael: aparece no extrato como pix rafael, e Conveniencia da Iara.
- Estabelecimentos: Marketp=Mercado Pago (mercado), Sumerbol/VERAO=mercado, Swift=carne, Giani=padaria, Bouti=padaria,
  Jim C=energetico, PJBank=condominio (valor varia, inclui agua), Clube=Pix pro Sandro todo dia 31 com a parte do Yago (~280) dentro.
- Agua vem dentro do condominio. Gas e botijao (~R$ 300, comprado em marco). Nenhum dos dois e conta fixa. Nao perguntar de novo.
- Fixas com valor variavel: luz e condominio. Lancar sempre o valor real do extrato, nunca a media.
"""
    write(CMD, c)
    print("CLAUDE.md patchado.")

print("PATCH V6 OK")
