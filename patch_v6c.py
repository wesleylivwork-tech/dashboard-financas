#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Patch V6C: trava anti-duplicata, lote de arquivos e leitura completa de PDF
# Idempotente: marca "(V6C)"

import io, os, re, shutil, sys, time

BOT = "/root/bot-iara/bot.mjs"
CMD = "/root/bot-iara/CLAUDE.md"

def read(p):
    with io.open(p, "r", encoding="utf-8") as f: return f.read()

def write(p, s):
    with io.open(p, "w", encoding="utf-8") as f: f.write(s)

s = read(BOT)
if "(V6C)" in s:
    print("bot.mjs ja tem V6C, pulando")
else:
    shutil.copy(BOT, BOT + ".bak_v6c_" + str(int(time.time())))
    linhas = s.split("\n")
    alvo = -1
    for i, ln in enumerate(linhas):
        if ln.startswith("REGRAS ADICIONAIS:"):
            alvo = i; break
    if alvo < 0:
        print("ERRO: nao achei REGRAS ADICIONAIS"); sys.exit(1)
    ln = linhas[alvo]
    pos = ln.rfind("`")
    if pos < 0:
        print("ERRO: nao achei o fim do template"); sys.exit(1)

    NOVAS = (
        " (V6C) TRAVA ANTI-DUPLICATA, A REGRA MAIS IMPORTANTE DE TODAS: "
        "(V6C-1) ANTES de lancar QUALQUER item vindo de extrato, fatura, CSV ou PDF, consulte a base com filtro de DATA e VALOR "
        "(um query por dia do documento ja resolve) e monte a lista do que ja existe. Item com mesma data e mesmo valor ja lancado "
        "NAO se lanca de novo, mesmo que a descricao esteja diferente. No fim, diga quantos itens eram novos e quantos foram pulados por ja existirem. "
        "(V6C-2) NUNCA reprocessar documento repetido: se o casal reenviar um arquivo que ja foi lancado (mesmo periodo, mesmos valores), "
        "avise 'esse extrato ja esta lancado, achei X itens iguais' e pergunte se quer que lance so o que falta. Nunca lance tudo por cima. "
        "(V6C-3) LOTE DE ARQUIVOS: quando chegarem varios arquivos seguidos, leia TODOS antes de responder e de UMA resposta so no fim, "
        "com o total por documento. Nunca responda 'pode mandar' para um arquivo que ja chegou. "
        "(V6C-4) PDF DE VARIAS PAGINAS: o texto extraido vem com marcadores de pagina. Antes de dizer que a fatura esta incompleta, "
        "confira quantas paginas vieram e some os itens de TODAS. Se o total dos itens nao bater com o total da fatura, releia o texto inteiro "
        "antes de pedir reenvio. Pedir reenvio de documento completo e o ultimo recurso. "
        "(V6C-5) Ao lancar item de extrato, escreva a descricao do jeito que aparece no documento, sem inventar sufixo de origem. "
    )
    linhas[alvo] = ln[:pos] + NOVAS + ln[pos:]
    write(BOT, "\n".join(linhas))
    print("bot.mjs V6C ok")

c = read(CMD)
if "(V6C)" in c:
    print("CLAUDE.md ja tem V6C, pulando")
else:
    shutil.copy(CMD, CMD + ".bak_v6c_" + str(int(time.time())))
    c += u"""

## (V6C) TRAVA ANTI-DUPLICATA (regra dura)
Antes de lancar qualquer coisa vinda de arquivo (extrato, fatura, CSV, PDF):
1. Liste as datas do documento.
2. Consulte a base de Gastos por essas datas e guarde os pares data+valor que ja existem.
3. Lance SO o que nao existe. Item com mesma data e mesmo valor JA E DUPLICATA, mesmo com descricao diferente.
4. No fim informe: "X novos, Y pulados por ja existirem".
Se o arquivo inteiro ja estiver lancado, diga isso e nao lance nada.

Historico: em 11/08/26 o extrato de julho do Wes foi reprocessado e gerou 45 lancamentos duplicados
(o mesmo extrato ja tinha sido lancado em 23/07). Foram arquivados na mao. Nao pode acontecer de novo.

## (V6C) ARQUIVOS EM LOTE
Quando o casal mandar varios arquivos seguidos, leia todos e responda UMA vez, com o resumo de cada documento.
Nunca responda "pode mandar" para arquivo que ja chegou.
PDF com varias paginas: some os itens de todas as paginas antes de dizer que falta alguma coisa.
"""
    write(CMD, c)
    print("CLAUDE.md V6C ok")

print("PATCH V6C OK")
