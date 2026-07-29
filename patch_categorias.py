import sys
P="/root/bot-iara/bot.mjs"
s=open(P,encoding="utf8").read()
if "CATEGORIAS_V2" in s:
    print("JA_APLICADO"); sys.exit(0)
# acha a lista de categorias validas e substitui
import re
alvo = re.search(r'Validas:\s*Mercado.*?Outros\.', s)
if not alvo:
    print("ANCORA_NAO_ENCONTRADA"); sys.exit(1)
nova = ("CATEGORIAS_V2 Validas: Mercado, Padaria, Restaurante/Lanche, Conveniencia, Combustivel, Transporte/Pedagio, "
        "Casa/Moradia, Saude/Farmacia, Educacao, Assinaturas, Carro, Lazer, Pet, Estetica, Compras, Transferencia, Divida, Taxas, Outros. "
        "REGRAS DE CATEGORIA (use o nome do estabelecimento e o valor): "
        "Transferencia = PIX interno entre Wes e Iara ou transferencia entre as contas do proprio casal (nao e gasto, e dinheiro circulando). "
        "Divida = pagamento de emprestimo a pessoas ou credores (Pai, Mae, Wanderley, Guilherme, Aibr Fidc, repasse, parcelamento de emprestimo). "
        "Taxas = juros do limite/cheque especial, IOF, seguro de cartao, anuidade, tarifas bancarias. "
        "IMPORTANTE: Transferencia, Divida e Taxas NAO sao consumo e nao entram no gasto do mes; ainda assim categorize corretamente. "
        "Pet = Petz, pet shop, banho/tosa do cachorro (Joao), racao, tapete higienico. "
        "Estetica = unha, sobrancelha, cabelo, salao, depilacao. "
        "Compras = Amazon, Mercado Livre, Shopee, Havan, Kalunga, Magalu e lojas de varejo em geral. "
        "Carro = combustivel, lavagem (Vitor), estacionamento, manutencao, pedagio do carro. "
        "Conveniencia = bobeirinhas do dia a dia, energetico, lanche rapido de conveniencia, valores pequenos recorrentes. "
        "Na duvida entre duas, escolha pelo valor e frequencia; se realmente nao souber, use Outros.")
s = s[:alvo.start()] + nova + s[alvo.end():]
open(P,"w",encoding="utf8").write(s)
print("APLICADO")
