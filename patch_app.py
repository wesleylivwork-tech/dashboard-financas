import re, sys
P="/root/bot-iara/bot.mjs"
s=open(P,encoding="utf8").read()

if "ATUALIZA_APP_HOOK" in s:
    print("JA_APLICADO"); sys.exit(0)

# bloco interceptor: roda o gerador do painel e responde, sem chamar a IA
hook = '''
        // ATUALIZA_APP_HOOK: republica o painel WI Finance sob demanda
        if (_raw && /\\b(atualiz\\w+|republic\\w+|sobe|sincroniz\\w+)\\b.*\\b(app|painel|dashboard|wi ?finance|financas|finan\\u00e7as)\\b/i.test(_raw)) {
          await tg("sendMessage", { chat_id: chatId, text: "Atualizando o WI Finance..." });
          try {
            const out = execFileSync("node", ["/root/dashfin/financas.mjs"], { encoding: "utf8", timeout: 120000 });
            const ok = /PUBLICADO OK/.test(out);
            await tg("sendMessage", { chat_id: chatId, text: ok ? "Pronto! WI Finance atualizado. Abra o app pra ver." : ("Rodei mas nao confirmou publicacao:\\n"+out.slice(-200)) });
          } catch(e) {
            await tg("sendMessage", { chat_id: chatId, text: "Falhou ao atualizar o app: "+(e.message||"erro").slice(0,150) });
          }
          continue;
        }
'''

# ancora: inserir logo antes de "await tg("sendChatAction", { chat_id: chatId, action: "typing" });\n        const texto ="
anchor = 'await tg("sendChatAction", { chat_id: chatId, action: "typing" });\n        const texto ='
idx = s.find(anchor)
if idx == -1:
    # fallback: antes de 'const texto = "[Mensagem enviada por'
    anchor2 = 'const texto = "[Mensagem enviada por'
    idx = s.find(anchor2)
    if idx == -1:
        print("ANCORA_NAO_ENCONTRADA"); sys.exit(1)
    # recua ate inicio da linha
    nl = s.rfind("\n", 0, idx)
    s = s[:nl] + "\n" + hook + s[nl:]
else:
    nl = s.rfind("\n", 0, idx)
    s = s[:nl] + "\n" + hook + s[nl:]

open(P,"w",encoding="utf8").write(s)
print("APLICADO")
