import sys, re
P="/root/bot-iara/bot.mjs"
s=open(P,encoding="utf8").read()
if "RENDA_REEMBOLSO_REGRA" in s: print("JA"); sys.exit(0)
regra=(" (H) RENDA_REEMBOLSO_REGRA: quando alguem disser que RECEBEU salario/renda/pagamento de trabalho "
 "(ex 'recebi 17k de salario', 'Iara recebeu 5k dia 5', 'caiu meu salario', 'entrou 16k'), atualize a base Financas Mensal "
 "(id 1941663727fa46afb6dab84a6cfcb8d9): ache a linha do mes atual pela propriedade Ano-Mes (AAAA-MM) via curl POST query, "
 "e SOME o valor recebido na propriedade Renda com curl PATCH (leia o valor atual e some, nao sobrescreva). "
 "Referencia: Iara ~5k dia 5 e ~5k dia 20; Wes ~16 a 18k dia 15. "
 "REEMBOLSO DE TERCEIRO: quando um terceiro (Yago, Patricia, ou Fatech - inclui Fabio Rogerio Lopes e os CNPJs 33.362.677 e 63.992.833) PAGAR ou reembolsar "
 "(ex 'Yago me pagou 500', 'Patricia pagou a fatura', 'caiu pix da Fatech'), isso NAO e renda do casal nem gasto; e devolucao do que o terceiro gastou no cartao. "
 "Registre na base de Gastos com Categoria=Terceiros, Observacao='Reembolso: NOME', e Valor NEGATIVO (abate o que o terceiro deve). "
 "APORTE: quando disser 'aporte de X na conta investimento' ou 'investi X', some X na propriedade Investido da base Financas Mensal do mes atual. ")
i=s.find("Tambem faz web, resumos e arquivos")
if i==-1: print("ANCORA_NAO_ENCONTRADA"); sys.exit(1)
s=s[:i]+regra+s[i:]
open(P,"w",encoding="utf8").write(s)
print("APLICADO")
