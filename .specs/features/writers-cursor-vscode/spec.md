# Writers Cursor + VS Code (P2) — Especificação

**Scope:** Medium. Estende o MVP: adiciona writers de config para Cursor e VS Code, selecionáveis por projeto. Segue o padrão do `claude-code-writer` já existente.

**Contexto (verificado no código):**
- Padrão de writer: `ConfigWriter.writeConfig(consumer, gatewayBaseUrl, hasAssignments) => WriteConfigResult`, com `managed-block` (`MANAGED_KEY='mcp-manager-gateway'`, `mergeManagedEntries`/`removeManagedEntries` genéricos no mapa). Template: `src/config-writers/claude-code-writer.ts`.
- `config-rewrite-service` hoje despacha pra **todos** os writers registrados (só `claude-code`), **ignorando** `consumer.clientFormats`. Precisa passar a despachar pelos formatos do consumidor.
- `consumer.clientFormats` default `[]`; `setClientFormats` existe no domínio mas **não** é exposto por API nem UI.
- **Claude Desktop deferido:** o usuário confirmou que seus 4 perfis são "uma opção de perfil no app" (troca interna, não data-dirs separados) → o writer por-arquivo `claude_desktop_config.json` não se aplica. Fora deste escopo; abordagem a repensar.

**Schemas confirmados (research-03):**
- Cursor `.cursor/mcp.json`: topo `mcpServers`, entry `{ type:"http", url, headers }` (converge com Claude Code).
- VS Code `.vscode/mcp.json`: topo `servers` (não `mcpServers`), entry `{ type:"http", url, headers }` (token direto no header; `inputs` não é necessário).

---

## Assumptions & Open Questions

| Assumption | Default | Rationale | Confirmado? |
| ---------- | ------- | --------- | ---------- |
| Dispatch por clientFormats, vazio → `['claude-code']` | Preserva comportamento P1 (projeto descoberto = claude-code) | Retrocompatível; não quebra testes existentes | ✅ |
| Cursor inclui `type:"http"` | Igual ao Claude Code (padrões convergindo) | Nossa gateway é Streamable HTTP; `type` explícito evita fallback pra SSE | ⚠️ verificar num Cursor real se necessário |
| Desktop fora de escopo | — | Perfis in-app, não graváveis por arquivo | ✅ |

**Open questions:** none.

---

## User Stories

### P1: Writer do Cursor ⭐

**Story:** Como dono da máquina, quero que o app grave `.cursor/mcp.json` apontando pro gateway quando o projeto tem 'cursor' selecionado.

**Acceptance Criteria (CFG-C):**
1. WHEN um projeto com 'cursor' em clientFormats e ≥1 atribuição tem config escrito THEN o sistema SHALL gravar `.cursor/mcp.json` com `mcpServers['mcp-manager-gateway'] = {type:'http', url:`<base>/mcp/<token>`, headers:{Authorization:`Bearer <token>`}}`, preservando outras entradas
2. WHEN reaplico sem mudança THEN a escrita SHALL ser idempotente (conteúdo igual → sem write)
3. WHEN o projeto fica sem atribuições THEN o sistema SHALL remover só a entrada gerenciada, preservando as demais
4. WHEN a gravação falha THEN o writer SHALL retornar status 'error' sem lançar (falha isolada)

### P1: Writer do VS Code ⭐

**Story:** idem, para `.vscode/mcp.json`.

**Acceptance Criteria (CFG-V):**
1. WHEN um projeto com 'vscode' e ≥1 atribuição tem config escrito THEN o sistema SHALL gravar `.vscode/mcp.json` com `servers['mcp-manager-gateway'] = {type:'http', url, headers:{Authorization}}`, preservando `inputs`/`sandbox`/outras entradas
2. Idempotência, cleanup em 0 atribuições e falha isolada — iguais a CFG-C 2/3/4

### P1: Dispatch por formato ⭐

**Story:** Como dono da máquina, quero que só os formatos que eu escolhi por projeto sejam escritos.

**Acceptance Criteria (CFG-D):**
1. WHEN um consumidor tem clientFormats=['cursor'] THEN o rewrite SHALL escrever só o `.cursor/mcp.json` (não claude-code nem vscode)
2. WHEN clientFormats está vazio THEN o rewrite SHALL usar o default `['claude-code']` (retrocompatível)
3. WHEN clientFormats=['claude-code','cursor','vscode'] THEN os três arquivos SHALL ser escritos; falha de um não aborta os outros

### P2: Selecionar formatos por projeto

**Story:** Como dono da máquina, quero escolher os formatos de cada projeto pela UI.

**Acceptance Criteria (FMT):**
1. WHEN eu chamo `PUT /api/consumers/:id/formats` com um array válido THEN o sistema SHALL persistir e retornar o consumidor atualizado
2. WHEN o array tem valor inválido (fora de claude-code|cursor|vscode) THEN o sistema SHALL responder 400
3. WHEN eu marco/desmarco formatos na UI de um projeto THEN a seleção SHALL persistir e refletir no próximo write-configs

---

## Requirement Traceability

| ID | Story | Status |
| -- | ----- | ------ |
| CFG-C1..C4 | Cursor writer | Pending |
| CFG-V1..V2 | VS Code writer | Pending |
| CFG-D1..D3 | Dispatch por formato | Pending |
| FMT-1..3 | API + UI de seleção | Pending |

## Success Criteria

- [ ] Marcar 'cursor' num projeto → write-configs grava `.cursor/mcp.json` correto; desmarcar remove só a entrada gerenciada
- [ ] VS Code idem em `.vscode/mcp.json` (topo `servers`)
- [ ] Projeto sem formatos explícitos continua recebendo claude-code (sem regressão)
- [ ] Suite completa verde (regressão zero sobre os 202 testes do P1)
