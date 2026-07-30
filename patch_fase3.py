#!/usr/bin/env python3
# Fase 3: ensina o bot a preencher Macro e Classe (Essencial/Luxo) e a perguntar quando a categoria nao esta clara.
import shutil, time
f = "/root/bot-iara/bot.mjs"
s = open(f, encoding="utf-8").read()
bak = f + ".bak_fase3_" + str(int(time.time()))
shutil.copy(f, bak)

anchor = "Tambem faz web, resumos e arquivos"

regras = (
 " (I) MACRO E CLASSE (novo): ao gravar um gasto na base, alem da Categoria preencha tambem duas propriedades select: Macro e Classe. "
 "MACRO agrupa a categoria: Mercado/Padaria/Restaurante/Lanche/Conveniencia=Alimentacao; Combustivel/Transporte/Pedagio/Carro=Carro; Casa/Moradia/Assinaturas=Moradia; Saude/Farmacia=Saude; Estetica/Compras/Educacao=Pessoal; Lazer=Lazer; Pet=Pet; Terceiros=Terceiros; Divida=Divida; o resto=Outros. "
 "CLASSE e Essencial ou Luxo pela regua: se a renda do casal caisse pela metade, ainda pagaria isso? Sim=Essencial (mercado, aluguel, luz, agua, gas, internet, telefone, saude, farmacia, combustivel, pet, IPVA, seguro, pedagio, consorcio do carro). Nao=Luxo (restaurante, conveniencia/bobeira, lazer, estetica, streaming, viagem, esporte, bebida, lavagem de carro). "
 "Terceiros e Divida ficam SEM Classe. Para itens MISTOS (roupa, utensilio de casa, compra diversa) PERGUNTE curto 'foi necessidade ou vontade?' e marque Essencial se necessidade, Luxo se vontade. Macro e Classe sao select: no JSON use o formato {\"select\":{\"name\":\"...\"}}. "
 "(J) CATEGORIA NAO CLARA (novo): se voce NAO conseguir deduzir a categoria com confianca pelo lugar/descricao, NAO chute Outros. PERGUNTE curto, ex 'nao consegui classificar LUGAR, e o que? (mercado, lazer, farmacia, carro...)', e so grave depois da resposta. "
)

if "(I) MACRO E CLASSE" in s:
    print("JA TEM regra (I), nada a fazer. backup:", bak)
elif anchor not in s:
    print("ERRO: ancora nao encontrada. Nada alterado. backup:", bak)
else:
    s = s.replace(anchor, regras + anchor, 1)
    open(f, "w", encoding="utf-8").write(s)
    print("PATCH FASE3 OK. novo tamanho:", len(s), "| backup:", bak)
