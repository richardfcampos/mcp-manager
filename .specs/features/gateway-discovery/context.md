# Gateway Discovery Context

**Gathered:** 2026-07-16
**Spec:** `.specs/features/gateway-discovery/spec.md`
**Status:** Ready for design

---

## Feature Boundary

O gateway `/mcp/:token` deixa de achatar tools e passa a expor exatamente 3 meta-tools de descoberta (`list_mcps`, `get_mcp_tools`, `call_mcp_tool`), escopadas por consumer; cada MCP registrado ganha campo `purpose` (manual, com fallback à descrição anunciada pelo upstream); cut-over direto no mesmo endpoint. Chaves permanecem só no cofre — projeto conhece apenas o token escopado.

---

## Implementation Decisions

### Modo de exposição

- Só meta-tools — sem modo achatado, sem toggle, sem endpoint versionado.
- `tools/list` sempre retorna as 3 meta-tools, mesmo com 0 MCPs atribuídos.

### Origem do "pra que serve"

- Campo `purpose` opcional na criação/edição do MCP (API + UI).
- Se vazio: fallback à descrição/instructions anunciada pelo upstream; se indisponível, `null` — MCP ainda listado.

### Migração

- Cut-over direto: mesmo endpoint, mesmos tokens, nenhum rewrite de config. Clientes veem o novo conjunto de tools na reconexão.

### Agent's Discretion

- Shape exato das respostas das meta-tools (campos além de slug/name/purpose).
- Nomes de tools sem prefixo em `get_mcp_tools` (par `{mcp, tool}` desambigua).
- Limite de truncamento de instructions no fallback.
- `list_mcps` responde do DB sem exigir conexão a upstreams.

### Declined / Undiscussed Gray Areas → Assumptions

- Rate limiting, observabilidade extra, idempotência de proxy — registrados como assumptions no spec (defaults do agente).

---

## Specific References

- Padrão "progressive discovery" citado ao usuário (análogo ao ToolSearch da Anthropic): revelar tools sob demanda em vez de inundar o contexto.
- Motivação de segurança: lib infectada num projeto não deve conseguir extrair chaves — projeto só tem token escopado; nada de secrets/command/env em respostas do gateway (SEC-10).

## Deferred Ideas

- Allowlist de tools individuais por consumer (escopo tool-level).
- Audit log de chamadas por consumer.

---

## Processo de execução (pedido do usuário, vale para esta feature)

- Fable atua **somente como orquestrador**: sub-agents implementam.
- Modelo escolhido por tarefa: mecânico/repetitivo → modelo mais barato (Sonnet/Haiku); design, gateway core e verificação → mais forte (Fable/Opus).
- Loops fix→re-verify até comportamento conforme spec (máx. 3 iterações antes de escalar).
- **Author ≠ verifier**: quem testa/verifica nunca é o agente que implementou.
