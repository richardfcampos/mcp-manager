# MCP Gateway Manager — Especificação

## Problem Statement

Hoje cada projeto (Claude Code, Cursor, VS Code, Claude Desktop) configura seus MCP servers na mão, com credenciais duplicadas e espalhadas em vários arquivos. Não há um lugar central para definir um MCP uma vez e dizer **quais projetos** podem usá-lo. Queremos um app em Docker, com interface web, que rode um **gateway MCP vivo**: você cadastra MCPs num lugar só (com secrets cifrados), liga/desliga por projeto, e cada projeto passa a "enxergar" apenas os MCPs autorizados a ele.

## Goals

- [ ] Cadastrar/editar/remover MCP servers pela web UI (stdio e remoto), com secrets cifrados em repouso
- [ ] Conhecer os "projetos" por auto-descoberta da pasta-raiz montada **e** por registro manual de caminho
- [ ] Atribuir acesso MCP↔projeto (matriz liga/desliga), com efeito imediato no que cada projeto recebe
- [ ] Gateway servir, por projeto, **apenas** os MCPs atribuídos — rodando os stdio dentro do container e proxeando os remotos
- [ ] Escrever no cada projeto/cliente o arquivo de config nativo apontando para a URL do gateway daquele projeto

---

## Out of Scope

Explicitamente excluído para conter escopo.

| Feature | Motivo |
| ------- | ------ |
| Multiusuário / RBAC de pessoas / SSO na UI | Ferramenta local pessoal; auth é só proteção do endpoint, não gestão de usuários |
| Marketplace/registry público de MCPs | Foco é gerenciar os MCPs que **você** define, não descobrir MCPs de terceiros |
| Editar Connectors/DXT do Claude Desktop pela API do app | Connectors são gerenciados pela UI do Desktop e não são graváveis por arquivo; usamos o caminho `mcpServers` + shim |
| Orquestração multi-host / cluster / alta disponibilidade | Um container num host local; sem HA |
| Versionar/rollback de configs de MCP | Nice-to-have futuro; não no MVP |
| Métricas/billing de uso de tokens dos MCPs | Fora do propósito de controle de acesso |

---

## Assumptions & Open Questions

Toda ambiguidade é resolvida com você ou registrada aqui — nada fica silenciosamente indefinido.

| Assumption / decisão | Default escolhido | Rationale | Confirmado? |
| -------------------- | ----------------- | --------- | ---------- |
| Modelo de acesso | **Gateway/proxy vivo** (endpoint MCP sempre no ar) | Sua escolha explícita na rodada 1 | ✅ y |
| Clientes-alvo p/ escrita de config | Claude Code `.mcp.json`, Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`, Claude Desktop (por perfil) | Sua escolha (todos marcados) | ✅ y |
| Descoberta de projetos | **Ambos**: auto-descobre subpastas da raiz montada + registro manual | Sua escolha na rodada 1 | ✅ y |
| Secrets dos MCPs | **Cifrados no app**, injetados como env quando o gateway sobe o MCP | Sua escolha na rodada 2 | ✅ y |
| Execução dos MCPs stdio | **Dentro do container** (Node `npx` + Python `uvx`) + proxy dos remotos | Sua escolha na rodada 2 | ✅ y |
| **Unidade de acesso = "alvo de acesso" (consumer)** | Dois tipos: `project` (pasta de código, recebe config escrito) e `desktop-profile` (perfil do Claude Desktop, recebe `mcpServers`+shim). Cada alvo tem token, URL de gateway e conjunto próprio de MCPs | Usuário confirmou que perfil do Desktop = conjunto próprio de MCPs, independente das pastas | ✅ y |
| Claude Desktop = múltiplos perfis | Cada perfil é um diretório de dados próprio (`Claude`, `Claude-3p`, …) com seu `claude_desktop_config.json`; cada perfil é um alvo de acesso independente | Verificado no seu sistema (2 perfis hoje, 0 mcpServers, usa Connectors/DXT) | ✅ y |
| Integração Claude Desktop = escrita de arquivo | Adicionar bloco `mcpServers` com `npx mcp-remote <url-do-gateway>` no config do perfil | É o único caminho gravável por arquivo (Connectors não são) | ✅ y |
| Raiz de workspace | `/Volumes/External Code/INTEL/Code/personal` montada **leitura+escrita** (precisa gravar config nos projetos) | Confirmado pelo usuário | ✅ y |
| Persistência | **SQLite** em volume montado | KISS p/ ferramenta local single-user | ✅ y |
| Auth do gateway + UI | Bind em localhost; **token bearer por alvo** embutido na URL/config do gateway; UI sem login (localhost-only) | Confirmado pelo usuário | ✅ y |
| Identidade por alvo no gateway | URL/rota única por alvo, ex.: `/mcp/<target-token>` | Simples de copiar pro config; casa com token bearer | ✅ y |
| Stack de implementação | A definir no Design (tendência: Node/TS + SDK MCP oficial) | Você respondeu "você decide" | ⚠️ Design |
| Chave-mestra de cifra | Fornecida via env var/arquivo na subida do container (AES-GCM ou libsodium) | Sem chave-mestra em texto plano no volume | ⚠️ Design |
| Transporte do gateway | Streamable HTTP + SSE (padrões MCP); esquema exato por cliente verificado no Design | Cobrir clientes remoto-nativos; fallback universal = shim `mcp-remote` | ⚠️ Design |

**Open questions:** none — todas as ambiguidades de comportamento foram resolvidas. Os 3 itens marcados `⚠️ Design` são detalhes de implementação (stack, algoritmo de cifra, esquema exato de transporte por cliente) a fixar no Design via docs oficiais/Context7 — não bloqueiam o spec.

---

## Implicit-Requirement Dimensions Sweep (Complex — todas as dimensões)

| Dimensão | Resolução |
| -------- | --------- |
| Validação de entrada & limites | Nome de MCP único e não-vazio; comando/URL obrigatório conforme transporte; env keys validadas; caminho de projeto deve existir e ser gravável (ver ACC/PRJ) |
| Falha / falha parcial | MCP que não sobe → estado `error` visível na UI, não derruba os outros; escrita de config parcial em N projetos é atômica por projeto e reporta quais falharam (ver GW-03, CFG-03) |
| Idempotência / retry / duplicado | Reaplicar atribuições é idempotente; reescrever config de um projeto é idempotente (mesmo conteúdo → sem mudança); nome de MCP duplicado é rejeitado |
| Fronteiras de auth & rate limit | Cada projeto só acessa o gateway com seu token; token inválido/desconhecido → 401 e nenhuma tool exposta (ver SEC-02). Rate limit explícito: N/A porque é ferramenta local single-user |
| Concorrência / ordenação | Edições concorrentes de config resolvidas por last-write no store; subida/derrubada de processo MCP serializada por MCP (ver GW-04) |
| Ciclo de vida / expiração de dados | Remover MCP remove atribuições e reescreve os configs afetados; rotação de token por projeto invalida o anterior (ver SEC-03). TTL de dados: N/A |
| Observabilidade | Status por MCP (running/stopped/error) e log básico de start/stop e de conexões por projeto na UI (ver GW-05) |
| Falha de dependência externa | MCP remoto inacessível → tool aparece indisponível para o projeto, com erro claro, sem travar a sessão do cliente (ver GW-06) |
| Integridade de transição de estado | MCP: `configured → starting → running → (error|stopped)`; transições inválidas bloqueadas (ver GW-04) |

---

## User Stories

### P1: Cadastrar um MCP server ⭐ MVP

**User Story**: Como dono da máquina, quero cadastrar um MCP server (stdio ou remoto) pela web UI com secrets cifrados, para tê-lo disponível num lugar central.

**Why P1**: Sem cadastro de MCP não há o que atribuir nem servir.

**Acceptance Criteria**:
1. WHEN eu crio um MCP stdio com nome, comando, args e env THEN o sistema SHALL persistir o registro e cifrar os valores de secret marcados antes de gravar
2. WHEN eu crio um MCP remoto com uma URL THEN o sistema SHALL persistir o registro com transporte = remoto
3. WHEN eu informo um nome já existente THEN o sistema SHALL rejeitar com erro de duplicidade e não criar o registro
4. WHEN eu deixo obrigatório vazio (nome, ou comando/URL conforme transporte) THEN o sistema SHALL rejeitar com erro de validação
5. WHEN eu leio um MCP cadastrado THEN o sistema SHALL nunca retornar o secret em texto plano na resposta (apenas indicação de "definido")

**Independent Test**: Criar um MCP stdio e um remoto pela UI; confirmar no store que o secret está cifrado e a leitura não expõe o valor.

---

### P1: Conhecer os projetos ⭐ MVP

**User Story**: Como dono da máquina, quero que o app liste meus projetos por auto-descoberta da pasta-raiz e me deixe adicionar caminhos manualmente, para eu escolher a quem dar acesso.

**Why P1**: A atribuição precisa de um catálogo de projetos.

**Acceptance Criteria**:
1. WHEN a raiz de workspace está montada THEN o sistema SHALL listar cada subpasta imediata como um projeto descoberto
2. WHEN eu registro manualmente um caminho existente THEN o sistema SHALL adicioná-lo como projeto
3. WHEN eu registro um caminho inexistente ou não-gravável THEN o sistema SHALL rejeitar com erro claro
4. WHEN uma subpasta descoberta some do disco THEN o sistema SHALL marcá-la como indisponível, não apagar suas atribuições silenciosamente

**Independent Test**: Montar a raiz com as pastas atuais; ver os 8 projetos listados; adicionar um caminho manual e ver que aparece.

---

### P1: Atribuir acesso MCP↔projeto ⭐ MVP

**User Story**: Como dono da máquina, quero ligar/desligar cada MCP por projeto numa matriz, para controlar exatamente quem usa o quê.

**Why P1**: É a função central do produto.

**Acceptance Criteria**:
1. WHEN eu ligo um MCP para um projeto THEN o sistema SHALL persistir a atribuição
2. WHEN eu desligo um MCP para um projeto THEN o sistema SHALL remover a atribuição e refletir isso no que o gateway serve àquele projeto
3. WHEN eu removo um MCP THEN o sistema SHALL remover todas as atribuições dele e reescrever os configs dos projetos afetados
4. WHEN eu consulto um projeto THEN o sistema SHALL listar exatamente os MCPs atribuídos a ele

**Independent Test**: Ligar MCP-A só para o projeto X; consultar X e Y; X lista A, Y não.

---

### P1: Gateway serve MCPs por projeto ⭐ MVP

**User Story**: Como cliente MCP de um projeto, quero conectar na URL do gateway do meu projeto e enxergar apenas as tools dos MCPs atribuídos a ele.

**Why P1**: É o que torna a atribuição real em runtime.

**Acceptance Criteria**:
1. WHEN um cliente conecta na URL do gateway do projeto X com token válido THEN o sistema SHALL expor **apenas** as tools dos MCPs atribuídos a X
2. WHEN um MCP atribuído é stdio THEN o gateway SHALL rodar o processo dentro do container e proxear suas tools
3. WHEN um MCP atribuído é remoto THEN o gateway SHALL proxear para o endpoint remoto
4. WHEN um MCP falha ao subir THEN o gateway SHALL manter os demais MCPs do projeto funcionando e reportar o MCP com falha como indisponível
5. WHEN o token é inválido/desconhecido THEN o gateway SHALL responder 401 e não expor tool alguma

**Independent Test**: Atribuir 2 MCPs a X e 1 a Y; conectar como X e listar tools → só as de X; derrubar 1 MCP e ver os outros seguirem.

---

### P1: Escrever config do cliente no projeto ⭐ MVP

**User Story**: Como dono da máquina, quero que o app grave o arquivo de config nativo do cliente em cada projeto, apontando para a URL do gateway daquele projeto, para eu não editar config na mão.

**Why P1**: Fecha o ciclo — o projeto realmente passa a usar o gateway.

**Acceptance Criteria**:
1. WHEN um projeto tem ao menos um MCP atribuído THEN o sistema SHALL escrever o `.mcp.json` (Claude Code) na raiz do projeto apontando para a URL do gateway daquele projeto
2. WHEN eu reaplico sem mudanças THEN a escrita SHALL ser idempotente (conteúdo igual → sem alteração de arquivo)
3. WHEN a gravação falha em um projeto (ex.: sem permissão) THEN o sistema SHALL reportar qual projeto falhou e não abortar os demais
4. WHEN um projeto fica sem MCPs atribuídos THEN o sistema SHALL remover/limpar a entrada do gateway do config daquele projeto

**Independent Test**: Atribuir MCP a um projeto; ver `.mcp.json` gravado com a URL correta; reaplicar e confirmar que o arquivo não muda.

---

### P2: Writers para Cursor, VS Code e Claude Desktop

**User Story**: Como dono da máquina, quero que o app escreva também `.cursor/mcp.json`, `.vscode/mcp.json` e o `mcpServers` (via shim `mcp-remote`) no perfil escolhido do Claude Desktop.

**Why P2**: Amplia a cobertura além do Claude Code; depende do writer genérico do P1.

**Acceptance Criteria**:
1. WHEN um projeto está marcado para Cursor/VS Code THEN o sistema SHALL escrever o config nativo correspondente apontando para a URL do gateway
2. WHEN eu associo um perfil do Claude Desktop a um conjunto de MCPs THEN o sistema SHALL escrever um bloco `mcpServers` com `npx mcp-remote <url-do-gateway>` no `claude_desktop_config.json` daquele perfil
3. WHEN um cliente não suportar transporte remoto nativo THEN o sistema SHALL usar o shim `mcp-remote` como fallback

**Independent Test**: Marcar um projeto para Cursor; ver `.cursor/mcp.json` gravado; associar um perfil do Desktop e ver o bloco `mcpServers` com o shim.

---

### P2: Status e saúde dos MCPs

**User Story**: Como dono da máquina, quero ver na UI o estado de cada MCP (running/stopped/error) e um log básico, para diagnosticar rápido.

**Why P2**: Importante para operar, mas o MVP funciona sem.

**Acceptance Criteria**:
1. WHEN um MCP está no ar THEN a UI SHALL mostrar `running`; quando cai, `error`/`stopped` com a última mensagem
2. WHEN eu abro um projeto na UI THEN o sistema SHALL mostrar quantos/quais MCPs ele receberá e o status de cada um

**Independent Test**: Subir um MCP quebrado e ver `error` com mensagem; corrigir e ver `running`.

---

### P3: Preview de tools por projeto

**User Story**: Como dono da máquina, quero ver, antes de conectar um cliente, a lista de tools que um projeto vai receber, para validar a config.

**Acceptance Criteria**:
1. WHEN eu peço o preview de um projeto THEN o sistema SHALL listar as tools agregadas dos MCPs atribuídos, sem precisar de um cliente externo

---

## Edge Cases

- WHEN dois MCPs expõem uma tool de mesmo nome para o mesmo projeto THEN o gateway SHALL desambiguar (ex.: prefixo por MCP) e não colidir
- WHEN o container reinicia THEN o sistema SHALL restaurar MCPs e atribuições do store e voltar a servir sem reconfiguração manual
- WHEN a raiz de workspace não está montada/está vazia THEN a UI SHALL indicar isso em vez de listar zero projetos silenciosamente
- WHEN um secret obrigatório de um MCP está ausente THEN o gateway SHALL recusar subir aquele MCP com erro claro, sem vazar o nome do secret como valor
- WHEN eu roto o token de um projeto THEN o token anterior SHALL parar de funcionar imediatamente

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| MCP-01 | P1: Cadastrar MCP | Design | Pending |
| MCP-02 | P1: Cadastrar MCP (remoto) | Design | Pending |
| MCP-03 | P1: Cadastrar MCP (duplicado/validação) | Design | Pending |
| SEC-01 | P1: Cadastrar MCP (secret cifrado, nunca exposto) | Design | Pending |
| PRJ-01 | P1: Conhecer projetos (auto-descoberta) | Design | Pending |
| PRJ-02 | P1: Conhecer projetos (registro manual) | Design | Pending |
| PRJ-03 | P1: Conhecer projetos (indisponível/validação) | Design | Pending |
| ACC-01 | P1: Atribuir acesso (ligar/desligar) | Design | Pending |
| ACC-02 | P1: Atribuir acesso (remover MCP → limpar) | Design | Pending |
| GW-01 | P1: Gateway serve só atribuídos | Design | Pending |
| GW-02 | P1: Gateway roda stdio interno | Design | Pending |
| GW-03 | P1: Gateway proxeia remoto / falha isolada | Design | Pending |
| SEC-02 | P1: Gateway 401 em token inválido | Design | Pending |
| CFG-01 | P1: Escrever `.mcp.json` (Claude Code) | Design | Pending |
| CFG-02 | P1: Escrita idempotente / falha isolada / limpeza | Design | Pending |
| CFG-03 | P2: Writers Cursor/VS Code | - | Pending |
| CFG-04 | P2: Writer Claude Desktop (shim mcp-remote) | - | Pending |
| GW-05 | P2: Status/saúde + log | - | Pending |
| SEC-03 | P2/P3: Rotação de token por projeto | - | Pending |
| GW-07 | P3: Preview de tools por projeto | - | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`
**Status values:** Pending → In Design → In Tasks → Implementing → Verified
**Coverage:** 20 IDs; MVP (P1) = 14 IDs; a mapear em tasks no Design.

---

## Success Criteria

- [ ] Consigo cadastrar um MCP, atribuí-lo a 1 projeto, conectar um cliente MCP na URL daquele projeto e ver **só** as tools daquele MCP
- [ ] Um segundo projeto sem atribuição não recebe tool alguma
- [ ] O `.mcp.json` é gravado no projeto correto e reaplicar não muda o arquivo
- [ ] Secrets nunca aparecem em texto plano na API nem em logs
- [ ] Reiniciar o container restaura tudo sem reconfiguração manual
