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

## Handoff

- **Fase atual:** ✅ **FEATURE COMPLETA** — Execute (55 tasks, 56 commits em `feat/mcp-gateway-mvp`) + **Verifier PASS** (15/15 ACs, 9/9 mutantes mortos, 198 testes, tree limpo). `validation.md` escrito. Servidor único sobe de verdade (smoke 200). MVP P1 entregue.
- **Pós-entrega:** P1 polido (teste multiplicidade MCP-01 `3c8c580`, clarificação de spec `339f6ea`); **PR pulado** (escolha do usuário — `feat/mcp-gateway-mvp` é a branch default do remoto com todo o código); **verificado rodando de verdade** no Docker: `/api/*` JSON, gateway 401 em token inválido, descoberta achou os 9 projetos com token cada. 202 testes.
- **Lição operacional (README `04c1512`):** `docker compose up` reusa a imagem cacheada `mcp-manager` (a Fase 1/T8 tagueou cedo, com placeholder T6) → sempre `docker compose up --build` após mudança de código. Um `up` sem `--build` rodou código obsoleto e simulou um "bug de produção" que não existia.
- **P2 (próximo ciclo, escolha do usuário):** (1) **BLOQUEADOR** — mecanismo dos 4 perfis Claude Desktop (`claude`,`claude-pessoal`,`claude-3`,`claude-jet`): só 2 data-dirs no disco (`Claude`,`Claude-3p`); precisa do usuário explicar como lança os 4; (2) writers Cursor `.cursor/mcp.json` + VS Code `.vscode/mcp.json` (desbloqueados, análogos ao Claude Code); (3) 5 gaps de precisão do spec em validation.md (redação).
- **Carry-forward:** copiar `.sql` de migration pro `dist/db/migrations/` na imagem Docker (tsc não copia assets) — resolver na Fase 6/T56.
- **Feature:** `mcp-gateway-manager`
- **Repo:** `/Volumes/External Code/INTEL/Code/personal/mcp-manager` (git remoto: `git@github.com:richardfcampos/mcp-manager.git`, ainda vazio)
- **tasks.md:** gerado via workflow (6 autores ∥ → síntese → crítico adversarial, 2 iters). Checagens: 0 ciclos, 15/15 IDs P1 cobertos, 0 violação de co-locação. Fix aplicado: T43→T44/T45/T46 (rota actions).
- **Fases:** P1 Scaffold+Docker(T1–T10) · P2 Store+Vault(T11–T14) · P3 Domínios(T15–T21) · P4 Gateway(T22–T29,T54; sequencial; T22=spike token) · P5 Writers(T30–T34; sequencial) · P6 API+UI(T36–T53,T55,T56; sequencial).
- **Próximo passo:** despachar workers das fases 2→6 em sequência → Verifier automático ao final. HOST bind refinado (env-overridable; localhost-only via compose publish) — ver design.md Tech Decisions.
- **Pendências P2:** mecanismo dos 4 perfis Claude Desktop (`claude`,`claude-pessoal`,`claude-3`,`claude-jet`) — só 2 data-dirs no disco (`Claude`,`Claude-3p`); resolver antes do writer Desktop.
- **Pesquisa:** `research/researcher-01..04-*.md`.
