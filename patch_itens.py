import sys
P="/root/bot-iara/bot.mjs"
s=open(P,encoding="utf8").read()
if "ITENS_DE_FATURA_REGRA" in s:
    print("JA_APLICADO"); sys.exit(0)
regra = " (G) ITENS_DE_FATURA_REGRA: quando o arquivo enviado for uma FATURA de cartao de credito, alem de anotar/atualizar a Fatura atual do cartao na base de Contas, lance CADA COMPRA da fatura na base Itens de Fatura (id be48663d7ede42349651f25b26a944f2) via curl POST https://api.notion.com/v1/pages (escreva o JSON em /tmp/item.json antes). Propriedades exatas: Compra (title = descricao da compra), Cartao (rich_text = nome exato do cartao, ex Cartao Iara Visa (dia 20)), Valor (number), Data (date start = data da compra AAAA-MM-DD), Parcela (rich_text, ex 3/10 se houver), Fatura mes (rich_text, ex Julho/26). IMPORTANTE: os itens da FATURA vao SO para essa base Itens de Fatura, NUNCA para a base de Gastos do dia a dia (senao duplica e suja o Saiu no mes). Compras avulsas do dia a dia continuam indo para a base de Gastos normal. No fim mande UM resumo curto: quantos itens da fatura lancados e o total. "
anchor = "Tambem faz web, resumos e arquivos"
i = s.find(anchor)
if i == -1:
    print("ANCORA_NAO_ENCONTRADA"); sys.exit(1)
s = s[:i] + regra + s[i:]
open(P,"w",encoding="utf8").write(s)
print("APLICADO")
