import sys
P="/root/bot-iara/bot.mjs"
s=open(P,encoding="utf8").read()
if "AUTO_REPUBLICA_HOOK" in s:
    print("JA_APLICADO"); sys.exit(0)
# garante import do execFile (async, nao trava o loop)
if "execFile," not in s and "execFile }" not in s and "execFile}" not in s:
    s=s.replace('import { execFileSync } from "node:child_process";',
                'import { execFileSync, execFile } from "node:child_process";')
hook='''
        // AUTO_REPUBLICA_HOOK: reflete no app WI Finance apos cada mensagem processada
        try { execFile("node", ["/root/dashfin/financas.mjs"], { timeout: 120000 }, () => {}); } catch(e) {}
'''
anchor = 'await tg("sendMessage", { chat_id: chatId, text: r });\n        }'
idx = s.find(anchor)
if idx == -1:
    print("ANCORA_NAO_ENCONTRADA"); sys.exit(1)
pos = idx + len(anchor)
s = s[:pos] + "\n" + hook + s[pos:]
open(P,"w",encoding="utf8").write(s)
print("APLICADO")
