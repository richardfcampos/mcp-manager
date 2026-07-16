# Gateway Discovery Orchestrator Specification

## Problem Statement

Hoje o gateway achata todas as tools de todos os MCPs atribuídos no `tools/list` (`<slug>__<tool>`), inundando o contexto da IA do projeto — e a IA não tem como perguntar "quais MCPs posso usar e pra que serve cada um". A mudança transforma o gateway em um **orquestrador com descoberta progressiva**: poucas meta-tools fixas, MCPs e tools revelados sob demanda, mantendo as chaves reais isoladas no cofre (o projeto só conhece o token escopado do gateway).

## Goals

- [ ] `tools/list` do gateway retorna sempre exatamente 3 meta-tools, independente de quantos MCPs o consumer tem
- [ ] A IA do projeto descobre via `list_mcps` quais MCPs tem acesso + o propósito de cada
- [ ] Nenhuma resposta do gateway jamais contém plaintext de secret (regressão SEC-01 preservada)
- [ ] Consumers existentes continuam funcionando sem reescrever config (mesma URL/token)

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Allowlist de tools individuais por consumer (escopo tool-level) | Nova capacidade; hoje o escopo é por-MCP. Deferred idea |
| Audit log de chamadas por consumer | Nova capacidade de observabilidade; não pedida |
| Modo achatado legado / endpoint versionado | Usuário escolheu cut-over direto — um único protocolo |
| Mudança nos config writers | Entrada gravada (`mcp-manager-gateway` + URL + token) não muda |
| Auth da UI / troca de token-na-URL | Fora do pedido; AD-016 mantido |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Modo de exposição | Só meta-tools (`list_mcps`, `get_mcp_tools`, `call_mcp_tool`) | Escolha do usuário (progressive discovery) | y |
| Origem do "pra que serve" | Campo `purpose` manual na UI; fallback = instructions/descrição anunciada pelo upstream | Escolha do usuário | y |
| Migração | Cut-over direto no mesmo endpoint `/mcp/:token` | Escolha do usuário; poucos consumers, uso pessoal | y |
| `list_mcps` não exige conectar upstreams | Responde do DB; fallback auto de descrição tenta upstream com isolamento (falha → descrição `null`) | Listagem deve ser rápida/confiável mesmo com upstream fora | n (default do agente) |
| Nomes de tools em `get_mcp_tools` | Nomes originais do upstream, sem prefixo `<slug>__` | O par `{mcp, tool}` do `call_mcp_tool` já desambigua; prefixo era artefato do achatamento | n (default do agente) |
| Rate limiting nas meta-tools | N/A | Rede confiável pessoal (AD-016); token por consumer já escopa | n (default do agente) |
| Observabilidade extra | N/A — logging existente inalterado | Ferramenta pessoal; sem pedido | n (default do agente) |
| Idempotência de `call_mcp_tool` | Responsabilidade do upstream (proxy verbatim, sem retry no gateway) | Gateway não conhece semântica das tools | n (default do agente) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Descoberta progressiva de MCPs ⭐ MVP

**User Story**: Como IA de um projeto com acesso ao gateway, quero perguntar quais MCPs posso usar, o que cada um faz e quais tools ele tem, para carregar no meu contexto só o que a tarefa precisa.

**Why P1**: É o núcleo do pedido — o gateway vira orquestrador de verdade.

**Acceptance Criteria**:

1. **DISC-01**: WHEN um cliente autenticado chama `tools/list` em `POST /mcp/:token` THEN o gateway SHALL retornar exatamente as 3 meta-tools `list_mcps`, `get_mcp_tools`, `call_mcp_tool` (com schemas de entrada), e nenhuma tool de upstream achatada.
2. **DISC-02**: WHEN o cliente chama `list_mcps` THEN o gateway SHALL retornar somente os MCPs atribuídos àquele consumer, cada um com `slug`, `name` e `purpose` — e lista vazia (não erro) para consumer com 0 MCPs.
3. **DISC-03**: WHEN o cliente chama `get_mcp_tools` com o slug de um MCP no seu escopo THEN o gateway SHALL retornar as tools daquele upstream com nomes originais (sem prefixo) e seus inputSchemas.
4. **DISC-04**: WHEN o cliente chama `call_mcp_tool` com `{mcp, tool, args}` de um MCP no escopo THEN o gateway SHALL despachar a chamada ao upstream e retornar o resultado verbatim.
5. **DISC-05**: WHEN `get_mcp_tools` ou `call_mcp_tool` referencia um slug fora do escopo do consumer (inclusive um slug que existe para outro consumer) THEN o gateway SHALL retornar um erro de tool (`isError`/erro JSON-RPC) sem revelar se o slug existe, e SHALL NOT contatar upstream algum.
6. **DISC-06**: WHEN `call_mcp_tool` recebe payload malformado (sem `mcp`/`tool` string, `args` não-objeto) THEN o gateway SHALL retornar erro de validação sem crash e sem contatar upstream.
7. **DISC-07**: WHEN um upstream em escopo falha ao conectar THEN `list_mcps` SHALL ainda listá-lo (dados do DB) e `get_mcp_tools`/`call_mcp_tool` daquele MCP SHALL retornar erro isolado — sem afetar chamadas a outros MCPs.
8. **DISC-08** (emenda 2026-07-16, achado em uso real): WHEN `call_mcp_tool` recebe qualquer campo de topo fora de `{mcp, tool, args}` (ex.: `input`, `arguments`) THEN o gateway SHALL retornar `isError` nomeando o campo recebido E o campo válido esperado (`args`), SHALL NOT contatar upstream algum, e SHALL NOT tratar o payload como "tool sem argumentos".
9. **DISC-09** (emenda 2026-07-16, achado em uso real): WHEN `call_mcp_tool` é chamado sem `args` THEN o gateway SHALL encaminhar `{}` ao upstream (nunca `undefined`), para que uma tool com parâmetros obrigatórios responda "campo X faltando" em vez de "expected object".

**Independent Test**: Registrar 2 MCPs, atribuir 1 ao consumer A; via cliente MCP real: `tools/list` → 3 meta-tools; `list_mcps` → só o MCP atribuído; `get_mcp_tools`+`call_mcp_tool` funcionam nele; slug do outro MCP → erro opaco; `call_mcp_tool` com `input` em vez de `args` → isError apontando `args` (não erro do upstream).

**Nota de design (DISC-08/09):** o nome original do campo era `arguments`, o que produzia `arguments` aninhado dentro do `arguments` do envelope `tools/call` do MCP. Em uso real a IA chamante mandou `input`; como `arguments` era opcional, o gateway leu "sem argumentos" e encaminhou `undefined`, e o upstream devolveu um erro de schema críptico. Renomear para `args` remove a colisão; DISC-08 impede que um campo errado vire silenciosamente "sem argumentos".

---

### P1: Propósito ("pra que serve") por MCP ⭐ MVP

**User Story**: Como dono do manager, quero dar a cada MCP uma descrição de propósito que a IA lê no `list_mcps`, para a IA saber quando usar cada MCP.

**Why P1**: Sem o "pra que serve", a descoberta lista nomes mudos.

**Acceptance Criteria**:

1. **DESC-01**: WHEN um MCP é criado/editado com campo `purpose` (texto opcional) via API THEN o sistema SHALL persistir e retorná-lo em GET (list/detail).
2. **DESC-02**: WHEN `purpose` está vazio e o upstream está conectável THEN `list_mcps` SHALL usar como descrição o que o upstream anuncia (instructions/description do initialize); WHEN também indisponível THEN descrição SHALL ser `null` (MCP ainda listado).
3. **DESC-03**: WHEN o usuário edita o MCP na UI THEN a UI SHALL exibir e salvar o campo de propósito (novo campo no formulário de registro/edição).

**Independent Test**: Criar MCP com purpose "consulta Jira da GDC" → `list_mcps` mostra o texto; limpar purpose → `list_mcps` mostra a descrição anunciada pelo upstream (fixture) ou `null` se upstream fora.

---

### P1: Isolamento de chaves preservado ⭐ MVP

**User Story**: Como dono do manager, quero garantir que a nova superfície de descoberta nunca vaze segredos, para que uma lib infectada num projeto não consiga extrair chaves via gateway.

**Why P1**: É a motivação de segurança do redesenho.

**Acceptance Criteria**:

1. **SEC-10**: WHEN qualquer meta-tool responde (sucesso ou erro) THEN a resposta SHALL NOT conter plaintext de secret, ciphertext, env values ou command/args do upstream — `list_mcps`/`get_mcp_tools` expõem apenas slug, name, purpose e tools.

**Independent Test**: MCP com secret `API_KEY=super-secret`; serializar respostas de todas as meta-tools (incluindo caminhos de erro) e afirmar ausência do plaintext, do ciphertext e de `command`/`env`.

---

### P1: Cut-over transparente ⭐ MVP

**User Story**: Como dono dos projetos já configurados, quero que os configs gravados continuem válidos após o deploy, para não reescrever nada.

**Why P1**: jira-gdc e jira-jetsales já estão em uso.

**Acceptance Criteria**:

1. **MIG-01**: WHEN o novo gateway sobe THEN o endpoint, formato de URL e tokens existentes SHALL permanecer válidos (`POST /mcp/:token`), 401 para token inválido/disabled preservado (regressão SEC-02), e nenhuma reescrita de config de consumer SHALL ser necessária.

**Independent Test**: Suite de integração existente do gateway (token válido/inválido) passa com o novo handler sem mudar URL/token das fixtures.

---

## Edge Cases

- WHEN consumer tem 0 MCPs THEN `list_mcps` SHALL retornar lista vazia e `tools/list` SHALL ainda expor as 3 meta-tools.
- WHEN `call_mcp_tool` referencia tool inexistente num MCP válido THEN o erro do upstream SHALL ser proxiado como erro de tool (não crash do gateway).
- WHEN dois MCPs têm tools de mesmo nome THEN não há colisão — o par `{mcp, tool}` desambigua (não existe mais namespace global achatado).
- WHEN o upstream anuncia instructions gigantes THEN `list_mcps` SHALL truncar a descrição de fallback (limite definido no design) para não recriar a inundação de contexto.

---

## Implicit-Requirement Dimensions (sweep)

| Dimension | Resolution |
| --------- | ---------- |
| Input validation & bounds | DISC-06 (payload de `call_mcp_tool`); truncamento de instructions (edge case) |
| Failure / partial-failure | DISC-07 (upstream fora, isolado); DESC-02 (fallback → null) |
| Idempotency / retry / duplicate | Assumption: proxy verbatim, sem retry — semântica é do upstream |
| Auth boundaries & rate limits | DISC-05 (escopo por consumer, erro opaco); rate limit N/A (AD-016) |
| Concurrency / ordering | N/A — padrão stateless por request existente inalterado; upstream-registry já serializa conexões |
| Data lifecycle / expiry | `purpose` vive na row do mcp_server, cascade no delete existente; N/A extra |
| Observability | N/A — logging existente; sem pedido |
| External-dependency failure | DISC-07 + DESC-02 |
| State-transition integrity | N/A — sem máquina de estados nova |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| DISC-01 | P1: Descoberta | Design | Pending |
| DISC-02 | P1: Descoberta | Design | Pending |
| DISC-03 | P1: Descoberta | Design | Pending |
| DISC-04 | P1: Descoberta | Design | Pending |
| DISC-05 | P1: Descoberta | Design | Pending |
| DISC-06 | P1: Descoberta | Design | Pending |
| DISC-07 | P1: Descoberta | Design | Pending |
| DISC-08 | P1: Descoberta (emenda) | Fix | Pending |
| DISC-09 | P1: Descoberta (emenda) | Fix | Pending |
| DESC-01 | P1: Propósito | Design | Pending |
| DESC-02 | P1: Propósito | Design | Pending |
| DESC-03 | P1: Propósito | Design | Pending |
| SEC-10 | P1: Isolamento | Design | Pending |
| MIG-01 | P1: Cut-over | Design | Pending |

**Coverage:** 12 total, 0 mapped to tasks, 12 unmapped ⚠️ (pre-design)

---

## Success Criteria

- [ ] Cliente MCP real (Claude Code) conectado a um consumer vê 3 tools no contexto em vez de N×tools achatadas
- [ ] `list_mcps` responde propósito correto para os 2 Jiras reais
- [ ] Nenhum teste de segredo detecta plaintext em qualquer resposta do gateway
- [ ] Projetos existentes seguem funcionando sem tocar nos configs
