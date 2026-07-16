# Project State — mcp-manager

Memória do projeto: decisões arquiteturais (AD-NNN) + snapshot de handoff.

## Decisions

| ID | Decisão | Rationale | Data |
| -- | ------- | --------- | ---- |
| AD-001 | Modelo = **gateway/proxy MCP vivo** (endpoint sempre no ar), não gerador de config estático | Escolha explícita do usuário | 2026-07-09 |
| AD-002 | Clientes-alvo p/ escrita de config: Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`, Claude Desktop (por perfil) | Escolha do usuário (todos) | 2026-07-09 |
| AD-003 | Descoberta de projetos = auto (subpastas da raiz montada) **+** registro manual | Escolha do usuário | 2026-07-09 |
| AD-004 | Secrets cifrados em repouso, injetados como env no runtime do MCP | Escolha do usuário; um único cofre | 2026-07-09 |
| AD-005 | Gateway roda MCPs stdio **dentro do container** (Node `npx` + Python `uvx`) e proxeia os remotos | Escolha do usuário; maioria dos MCPs é stdio | 2026-07-09 |
| AD-006 | Claude Desktop = múltiplos perfis, cada um com data-dir + `claude_desktop_config.json` próprios; integração via bloco `mcpServers` + shim `npx mcp-remote` | Verificado no sistema (perfis `Claude`, `Claude-3p`; 0 mcpServers; usa Connectors/DXT) | 2026-07-09 |
| AD-007 | Stack a definir no Design (tendência Node/TS + SDK MCP oficial) | Usuário respondeu "você decide" | 2026-07-09 |
| AD-008 | Unidade de acesso = **"alvo de acesso" (consumer)**, dois tipos: `project` (pasta) e `desktop-profile` (perfil). Cada alvo tem token + URL de gateway + conjunto próprio de MCPs | Usuário: perfil do Desktop = conjunto próprio de MCPs, independente das pastas | 2026-07-09 |
| AD-009 | Mount da raiz `/Volumes/External Code/INTEL/Code/personal` em **leitura+escrita** | Confirmado pelo usuário | 2026-07-09 |
| AD-010 | Defaults MVP: **SQLite** (volume) + UI localhost sem login + **token bearer por alvo** na URL | Confirmado pelo usuário | 2026-07-09 |
| AD-011 | Arquitetura = **construir do zero no SDK MCP oficial** (não reusar/estender MetaMCP) | Escolha do usuário após pesquisa build-vs-reuse | 2026-07-09 |
| AD-012 | Stack: Node 22 + TS + **Express** (API+gateway) · **React+Vite+Tailwind** (UI SPA servida estática) | Casa c/ projetos do usuário + exemplos do SDK usam Express | 2026-07-09 |
| AD-013 | DB = SQLite via **better-sqlite3** (default seguro sobre `node:sqlite`) | Estável/síncrono; relatórios divergiram sobre node:sqlite | 2026-07-09 |
| AD-014 | Cifra de secrets = Node `crypto` **AES-256-GCM**, IV por secret, master key via env `MCP_MANAGER_MASTER_KEY` | Sem dep externa; padrão sólido | 2026-07-09 |
| AD-015 | MCPs stdio rodam via **`StdioClientTransport` do SDK** (spawna o child); imagem `node:22-slim` + `uv` copiado de `ghcr.io/astral-sh/uv` | SDK já gerencia processo; Node+Python na mesma imagem | 2026-07-09 |
| AD-016 | **Exposição na rede** (supersede o "localhost-only" do AD-010): publica em **0.0.0.0**, porta **7788**, sem login na UI; `MCP_MANAGER_PUBLIC_BASE_URL=http://intel:7788` nos configs gravados | Usuário confirmou; alinha ao padrão dos outros projetos do workspace (todos expõem `PORT:PORT` em 0.0.0.0, sem auth). Tokens por-alvo ainda protegem o gateway; UI sem auth → só rede confiável | 2026-07-12 |
| AD-017 | **Workspace = `/Volumes/External Code/INTEL/Code` inteiro** (12 categorias, `WORKSPACE_ROOT` + mount) + **auto-descoberta em 2 níveis marker-based** (revisa PRJ-01 de 1→2 níveis) | Usuário escolheu; projetos ficam em `Code/<categoria>/<projeto>`, não só em `personal`. Marker-based (package.json/.git/etc.) evita registrar `src/`,`dist/` de projetos de 1º nível | 2026-07-12 |
| AD-018 | **Linguagem de design da UI = "network-ops console"**: dark grafite-verde + acento fósforo único (#9be870), Bricolage Grotesque/IBM Plex Sans/IBM Plex Mono self-hosted, densidade por divisórias hairline, primitivos em `ui-primitives.tsx` — ver `docs/design-guidelines.md` | Redesign a pedido do usuário ("melhore tudo, usabilidade e estética"); substituiu o Tailwind-default slate/blue. Futuras telas estendem esta linguagem | 2026-07-12 |
| AD-019 | **Gateway = orquestrador com descoberta progressiva**: `tools/list` expõe SÓ 3 meta-tools (`list_mcps`, `get_mcp_tools`, `call_mcp_tool`); fim do achatamento `<slug>__<tool>`; cut-over direto no mesmo `/mcp/:token`; campo `purpose` por MCP (manual, fallback = instructions do upstream) | Escolha do usuário (feature `gateway-discovery`): reduz inundação de contexto na IA, IA pergunta "quais MCPs posso usar e pra que serve" sob demanda | 2026-07-16 |
| AD-020 | **Processo de execução**: Fable atua só como orquestrador; sub-agents implementam com modelo escolhido por tarefa (mecânico→barato, design/verify→forte); loops fix→re-verify; **author ≠ verifier** sempre | Pedido explícito do usuário junto com a feature gateway-discovery | 2026-07-16 |

## Handoff

- **Feature ativa: `gateway-discovery`** — branch `feat/gateway-discovery` (specs commitados em `80afa6a`). **O QUÊ:** gateway deixa de achatar tools (`<slug>__<tool>`) e passa a expor SÓ 3 meta-tools (`list_mcps`/`get_mcp_tools`/`call_mcp_tool`), escopadas pela matriz de atribuição por consumer; campo `purpose` por MCP (manual na UI, fallback = instructions do upstream truncadas em 400); cut-over direto no mesmo `/mcp/:token`. **POR QUÊ:** IA do projeto pergunta "quais MCPs posso usar e pra que serve" sob demanda (menos contexto), e a superfície nova nunca vaza secrets/command/env (SEC-10) — chaves ficam só no cofre, projeto só tem o token escopado.
- **Progresso:** ✅ **FEATURE COMPLETA — Verifier PASS** (2026-07-16). 4 fases / 10 tasks / 11 commits de código na branch (T1–T3 Sonnet, T4–T7 Opus, T8–T10 Sonnet) + 1 fix loop (tipagem `InsertServerInput.purpose` — pego por diagnóstico do orquestrador via `pnpm build`, corrigido em `827aa64`; lesson L-001 candidate gravada). Verifier (Opus, author≠verifier): 12/12 ACs c/ evidência, desvios B1–B5 confirmados, **sensor 7/7 mutantes mortos**, gate build+lint+**277/277**. Notas não-bloqueantes: DESC-03 UI sem teste automatizado (inspeção); strip de campo extra no get_mcp_tools correct-by-construction sem teste dedicado.
- **Pós-entrega pendente (decisão do usuário):** (1) PR/merge da `feat/gateway-discovery` → main; (2) rebuild do container (`docker rmi -f mcp-manager && docker compose up -d`) pra ativar o protocolo novo em `intel:7788`; (3) preencher `purpose` dos 2 Jiras na UI; (4) follow-ups opcionais das notas do Verifier.
- **Fase anterior (MVP):** ✅ **FEATURE COMPLETA** — Execute (55 tasks, 56 commits em `feat/mcp-gateway-mvp`) + **Verifier PASS** (15/15 ACs, 9/9 mutantes mortos, 198 testes, tree limpo). `validation.md` escrito. Servidor único sobe de verdade (smoke 200). MVP P1 entregue.
- **Pós-entrega:** P1 polido (teste multiplicidade MCP-01 `3c8c580`, clarificação de spec `339f6ea`); **PR pulado** (escolha do usuário — `feat/mcp-gateway-mvp` é a branch default do remoto com todo o código); **verificado rodando de verdade** no Docker: `/api/*` JSON, gateway 401 em token inválido, descoberta achou os 9 projetos com token cada. 202 testes.
- **Lição operacional (README `04c1512`):** `docker compose up` reusa a imagem cacheada `mcp-manager` (a Fase 1/T8 tagueou cedo, com placeholder T6) → sempre `docker compose up --build` após mudança de código. Um `up` sem `--build` rodou código obsoleto e simulou um "bug de produção" que não existia.
- **P2 writers Cursor + VS Code ✅** (feature `writers-cursor-vscode`, `0294a06`..`63b8008`): cursor-writer, vscode-writer, dispatch por `clientFormats` (vazio→claude-code), rota `PUT /api/consumers/:id/formats`, seletor de formato na UI. **217 testes, 0 regressão**.
- **Claude Desktop — DEFERIDO (decisão do usuário):** os 4 perfis são "uma opção de perfil no app" (troca interna, não data-dirs separados) → writer por-arquivo `claude_desktop_config.json` não se aplica; abordagem a repensar (connectors são gerenciados na UI do app, não graváveis por arquivo).
- **Ainda aberto (não-bloqueante):** 5 gaps de precisão do spec em `validation.md` (redação); Verifier formal do P2 não rodado (coberto por 18 testes derivados do spec + suite verde).
- **Carry-forward:** copiar `.sql` de migration pro `dist/db/migrations/` na imagem Docker (tsc não copia assets) — resolver na Fase 6/T56.
- **Feature:** `mcp-gateway-manager`
- **Repo:** `/Volumes/External Code/INTEL/Code/personal/mcp-manager` (git remoto: `git@github.com:richardfcampos/mcp-manager.git`, ainda vazio)
- **tasks.md:** gerado via workflow (6 autores ∥ → síntese → crítico adversarial, 2 iters). Checagens: 0 ciclos, 15/15 IDs P1 cobertos, 0 violação de co-locação. Fix aplicado: T43→T44/T45/T46 (rota actions).
- **Fases:** P1 Scaffold+Docker(T1–T10) · P2 Store+Vault(T11–T14) · P3 Domínios(T15–T21) · P4 Gateway(T22–T29,T54; sequencial; T22=spike token) · P5 Writers(T30–T34; sequencial) · P6 API+UI(T36–T53,T55,T56; sequencial).
- **Próximo passo:** despachar workers das fases 2→6 em sequência → Verifier automático ao final. HOST bind refinado (env-overridable; localhost-only via compose publish) — ver design.md Tech Decisions.
- **Pendências P2:** mecanismo dos 4 perfis Claude Desktop (`claude`,`claude-pessoal`,`claude-3`,`claude-jet`) — só 2 data-dirs no disco (`Claude`,`Claude-3p`); resolver antes do writer Desktop.
- **Pesquisa:** `research/researcher-01..04-*.md`.
