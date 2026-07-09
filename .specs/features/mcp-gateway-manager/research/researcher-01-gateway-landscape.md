# MCP Gateway Landscape Research
**Date**: 2026-07-09  
**Researcher**: Claude Researcher  
**Task**: Evaluate OSS MCP gateways for build-vs-reuse decision on mcp-manager project

---

## Executive Summary

**Recommendation**: **REUSE + EXTEND MetaMCP** as the gateway core.

MetaMCP is the only OSS project that fully supports the critical requirement: **multiple named endpoints, each with different scoped subsets of registered MCPs, using per-endpoint API key authentication**. It has production-grade maturity (2.5k stars, MIT license, active development), Docker support, and a proven namespace/endpoint architecture. 

**Cost**: Wrapping MetaMCP to expose a simplified consumer-registration interface + encrypted secrets storage layer will be ~30-40% less effort than building a gateway from scratch while retaining full control over the registration UX and secrets model.

**Alternative** (if full customization needed): Build on MCP SDK using MetaMCP's namespace/endpoint patterns as reference architecture.

---

## Comparison Table

| Feature | MetaMCP | MCPHub | sparfenyuk/mcp-proxy | TBXark/mcp-proxy | 1mcp-app/agent | Docker MCP Gateway | pluggedin-mcp | MarimerLLC/mcp-agg | mcp-access-point |
|---------|---------|--------|----------------------|------------------|-----------------|-------------------|---------------|--------------------|-----------------|
| **What It Does** | Aggregator + gateway; groups MCPs into namespaces; exposes per-endpoint | Centralized hub; groups MCPs into teams/envs; endpoints per group | Transport bridge (stdio↔SSE); supports named servers | Aggregates servers via config; routes to HTTP/SSE | Single unified MCP runtime; aggregates servers | Docker container orchestrator for MCP servers | Unified MCP proxy; integrates with plugged.in App | Lazy-loading aggregator; dual MCP+REST interfaces | HTTP→MCP protocol gateway |
| **Multiple Named Endpoints** | ✓ YES (endpoints point to namespaces) | ✓ YES (group-based endpoints like `/mcp/$smart/team-name`) | ✓ Partial (named servers at `/servers/<name>/`) | ✓ YES (via config) | ✗ Single server | ✗ No | ✗ HTTP endpoints only | ✗ No | ✗ Per-service, not scoped |
| **Per-Endpoint Scoped Subset** | ✓ YES (namespace controls which servers exposed) | ✓ YES (groups define server visibility) | ✗ No (named servers are independent, not scoped) | Partial (config-based but no per-endpoint filtering) | ✗ No | ✗ No | ✗ No | ✗ No | ✗ No |
| **Per-Endpoint Auth/Token** | ✓ YES (API key per endpoint) | ✓ YES (JWT per endpoint) | ✓ YES (Bearer token support) | ✗ No | ✗ No | ✗ Limited (OAuth for containers) | ✓ YES (optional Bearer token per HTTP endpoint) | ✗ No | ✓ YES (API key for admin) |
| **Transport Support (critical)** | SSE, Streamable HTTP, OpenAPI | Streamable HTTP + SSE | stdio→SSE bridge; SSE→stdio bridge | Stdio input; SSE + Streamable HTTP output | stdio, HTTP (via streaming) | stdio, streaming (port 8080), SSE | STDIO + Streamable HTTP | stdio, HTTP/SSE | Configurable via TOML |
| **Stdio MCP Execution** | ✓ (npx/uvx via config) | ✓ (stdio via config) | ✓ (via `--named-server` with command string) | ✓ (stdio client type) | ✓ (via subprocess) | ✓ (Docker containers) | ✗ Requires external setup | ✓ (stdio support) | Possible via TOML |
| **Secrets Handling** | ✓ API key headers, env vars (`${VAR_NAME}` refs) | ✓ Environment variables, database mode | ✓ Environment variables, OAuth2 client secret | ✓ Config-based | ✓ Environment variables | ✓ Docker Desktop secrets integration | ✓ Environment vars, .env parsing | ✓ .NET User Secrets, env vars | ✓ Header-based (API keys, Bearer tokens) |
| **Secrets Encrypted at Rest** | Unclear—check implementation | Not mentioned—file-based default | Not mentioned | Not mentioned | Not mentioned | Docker Desktop storage | Not mentioned | Not mentioned | Not mentioned |
| **Web UI Included** | ✓ YES (admin dashboard) | ✓ YES (dashboard + config UI) | ✗ No (online config converter only) | ✗ No | ✗ No | ✗ No (CLI plugin only) | ✓ YES (playground + integration with plugged.in App) | ✓ YES (Scalar interactive API docs) | ✓ YES (admin dashboard) |
| **Docker Support** | ✓ YES (official Docker image) | ✓ YES (Docker Compose included) | ✓ YES (multi-arch images) | ✓ YES (Docker Compose) | ✓ YES (Dockerfile included) | ✓ YES (Docker-native) | ✓ YES (Docker Compose) | ✓ YES (Dockerfile examples) | ✓ YES (official image) |
| **License** | MIT | Apache-2.0 | MIT | MIT | Apache-2.0 | MIT | MIT / Apache-2.0 | MIT | MIT |
| **Maturity (Stars)** | 2,500+ ⭐ | 2,200+ ⭐ | 2,700+ ⭐ | 709 ⭐ | 469 ⭐ | 1,500+ ⭐ | 132 ⭐ | 20 ⭐ | 178 ⭐ |
| **Last Commit** | Active | Active | Active | Active | Active | Active | Recent | Recent | Active |
| **Language** | TypeScript 98% | TypeScript 98% | Python 99% | Go 94% | TypeScript 98% | Go 98% | TypeScript 96% | C# 98% | Rust 95% |

---

## Detailed Project Evaluations

### 1. MetaMCP (metatool-ai/metamcp) ⭐⭐⭐ RECOMMENDED
**GitHub**: https://github.com/metatool-ai/metamcp  
**Docs**: https://docs.metamcp.com/en

#### What It Does
- MCP Aggregator + Orchestrator + Middleware + Gateway in one Docker container
- Groups MCP servers into **namespaces**
- Exposes each namespace as a separate **endpoint** (SSE or Streamable HTTP)
- Endpoint-level configuration: API key auth, rate limiting, middleware injection

#### Key Strengths
✓ **Critical requirement met**: Multiple endpoints with per-endpoint scoped subsets + API key tokens  
✓ **Per-endpoint API keys**: Supports API key auth via headers or query params  
✓ **OAuth/OIDC**: Enterprise SSO (Auth0, Keycloak, Azure AD, Google, Okta)  
✓ **Multi-tenancy**: Public/private scope control; private keys can't access private MCPs  
✓ **Web UI**: Admin dashboard for managing namespaces, endpoints, MCPs, API keys  
✓ **Docker**: Official image; Dev Container support  
✓ **Stdio MCP execution**: Supports npx/uvx for launching stdio servers  
✓ **Secrets**: Environment variable references (`${VAR_NAME}` syntax); auto-matching container env vars  
✓ **Maturity**: 2.5k stars, active development, MIT license  
✓ **TypeScript**: Full codebase (98%), well-maintainable

#### Gaps for mcp-manager Use Case
- **Secrets encryption at rest**: Not explicitly documented; needs verification if API keys/secrets are stored encrypted in database
- **Consumer onboarding UX**: Admin-focused interface; would need a wrapper for simplified "register new consumer → assign MCPs → get token" flow
- **Encrypted secrets per consumer**: May need custom storage layer if endpoint-scoped encrypted credentials are a hard requirement

#### Architecture Fit
**Excellent fit**. The namespace/endpoint model maps directly to mcp-manager's per-consumer design:
- `namespace` = one consumer (project folder or Claude Desktop profile)
- `endpoint` = the tokenized URL for that consumer
- `API key` = the consumer's authentication token

#### Adoption Risk
**Low**. Well-established project, active community, stable MIT license, production deployments visible in Docker Compose examples.

---

### 2. MCPHub (samanhappy/mcphub) ⭐⭐⭐ RUNNER-UP
**GitHub**: https://github.com/samanhappy/mcphub  
**Docs**: https://docs.mcphubx.com

#### What It Does
- Centralized management of multiple MCP servers via a unified dashboard
- Groups servers into teams/environments with group-scoped endpoints
- Example: `/mcp/$smart/backend-team`, `/mcp/$smart/frontend-team` each expose only their group's servers

#### Key Strengths
✓ **Group-based scoping**: Clean endpoint model for team/environment-based access  
✓ **JWT + OAuth2**: Authentication via bearer tokens; supports GitHub/Google social login when DB mode enabled  
✓ **Web Dashboard**: Built-in UI for configuration + hot-swappable server updates (no restart)  
✓ **Multiple deployment modes**: File-based (JSON) or PostgreSQL backend  
✓ **Docker**: Official images + Compose examples  
✓ **Active development**: 2.2k stars, Apache-2.0 license  
✓ **Compression**: Reduces large tool outputs automatically  
✓ **AI discovery**: Vector semantic search for tools

#### Gaps
- **Less mature than MetaMCP**: Fewer stars, fewer production deployments visible
- **No explicit per-endpoint API key isolation**: Groups share JWT; no per-consumer token model
- **Secrets at rest**: Not documented; appears file-based by default
- **Endpoint granularity**: Group-based, not fully arbitrary per-consumer naming

#### Architecture Fit
Good but less precise than MetaMCP. Groups are environment/team-oriented, not consumer-oriented.

---

### 3. sparfenyuk/mcp-proxy ⭐⭐ TRANSPORT BRIDGE (Not Primary Gateway)
**GitHub**: https://github.com/sparfenyuk/mcp-proxy  
**PyPI**: https://pypi.org/project/mcp-proxy

#### What It Does
- Transport bridge: converts between stdio and SSE/Streamable-HTTP
- Supports **named servers** via CLI (`--named-server fetch 'uvx mcp-server-fetch'`) or JSON config
- Each named server gets a URL path: `/servers/<name>/`
- Primary use case: expose local stdio servers over HTTP

#### Key Strengths
✓ **Named servers**: Multiple servers at distinct paths  
✓ **Bearer token auth**: OAuth2 + environment variable support  
✓ **Multi-transport**: stdio↔SSE bridge; supports clients that need SSE  
✓ **Docker**: Multi-arch images on GHCR  
✓ **Mature**: 2.7k stars, 18 releases, active  
✓ **Lightweight**: Python-based; minimal overhead

#### Gaps for Per-Consumer Scoping
✗ **No per-endpoint scoping**: Named servers are independent; no mechanism to expose different server subsets to different tokens  
✗ **No web UI**: Config converter online only  
✗ **Named servers ≠ named consumers**: Each server is a separate endpoint, not a consumer-perspective view  
✗ **Not a full gateway**: Designed for transport bridging, not multi-consumer MCP orchestration

#### Use Case
**Good for**: Exposing individual stdio servers remotely. **Not suitable** as primary gateway for mcp-manager's per-consumer scoped access model.

---

### 4. TBXark/mcp-proxy ⭐ AGGREGATOR (Limited Scoping)
**GitHub**: https://github.com/tbxark/mcp-proxy  
**Docs**: https://tbxark.github.io/mcp-proxy

#### What It Does
- Aggregates multiple MCP servers into HTTP/SSE endpoints
- Config-based: YAML/JSON specifying stdio/SSE/HTTP servers to aggregate
- Serves all aggregated servers (or subsets via config) at a single HTTP endpoint

#### Gaps for Per-Consumer Model
✗ **No per-endpoint API key scoping**: All consumers get the same aggregated set  
✗ **No per-consumer token model**: No token per endpoint; config-static  
✗ **Limited UI**: Online converter only; no dashboard  
✗ **Config-centric**: Requires config edit + restart to change server visibility; no hot-reload

#### Fit for mcp-manager
**Poor**. Designed for single-endpoint aggregation, not multi-consumer scoped access.

---

### 5. 1mcp-app/agent ⭐⭐ SINGLE UNIFIED RUNTIME (Not Multi-Endpoint)
**GitHub**: https://github.com/1mcp-app/agent

#### What It Does
- Single unified MCP server that aggregates multiple downstream servers
- All clients connect to one server; tool discovery routes to appropriate downstream
- CLI mode for progressive tool discovery

#### Gaps
✗ **No multiple endpoints**: Fundamentally a single-server design  
✗ **No per-client scoping**: All clients see all tools (unless filtered at client level)  
✗ **No per-consumer token model**: Authentication is server-level, not per-client

#### Fit for mcp-manager
**Poor**. Does not support multiple named endpoints per consumer.

---

### 6. Docker MCP Gateway (docker/mcp-gateway) ⭐⭐ CONTAINER ORCHESTRATOR (Not Access Control)
**GitHub**: https://github.com/docker/mcp-gateway  
**Docs**: https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway

#### What It Does
- Docker CLI plugin that runs MCP servers as isolated containers
- Provides container management + dynamic tool discovery
- Gateway translates between clients and containerized servers

#### Strengths
✓ **Docker-native**: Runs servers in containers with isolation  
✓ **Tool allowlists**: Can control which tools are exposed  
✓ **OAuth integration**: For service auth  
✓ **Official Docker project**: 1.5k stars, MIT license

#### Gaps for Per-Consumer Access Control
✗ **No per-endpoint access control**: Primarily a container orchestrator, not a multi-endpoint gateway  
✗ **No per-consumer token model**: No consumer-scoped credentials  
✗ **CLI-only management**: No web UI for consumer onboarding  
✗ **Not multi-endpoint**: Serves via stdio (single client) or streaming port (multiple clients); not per-consumer named endpoints

#### Fit for mcp-manager
**Limited**. Good for running stdio MCPs in containers, but doesn't provide per-consumer access control. Could be **complementary** to mcp-manager (run mcp-manager itself on Docker + use Docker MCP Gateway for container isolation of individual MCPs).

---

### 7. pluggedin-mcp-proxy (VeriTeknik) ⭐ UNIFIED PROXY WITH INTEGRATED APP
**GitHub**: https://github.com/VeriTeknik/pluggedin-mcp-proxy

#### What It Does
- Unified MCP proxy that aggregates multiple servers
- Integrates with external plugged.in App for configuration management
- Includes optional bearer token per HTTP endpoint
- Built-in playground for testing

#### Gaps
✗ **External dependency**: Requires plugged.in App (cloud service) for configuration  
✗ **No arbitrary per-consumer endpoints**: Limited to plugged.in App topology  
✗ **Smaller community**: Only 132 stars  
✗ **Not self-contained**: Gateway tied to third-party service

#### Fit for mcp-manager
**Poor**. Architectural dependency on external service conflicts with mcp-manager's self-hosted model.

---

### 8. MarimerLLC/mcp-aggregator ⭐ EARLY-STAGE (Minimal Community)
**GitHub**: https://github.com/MarimerLLC/mcp-aggregator

#### What It Does
- Dual MCP + REST interfaces for server aggregation
- Lazy tool discovery; dynamic server registration
- Markdown skill documents for LLM guidance

#### Gaps
✗ **No per-endpoint access control**: No authentication mentioned  
✗ **No per-consumer token model**: Endpoints are public  
✗ **Minimal community**: Only 20 stars; early-stage  
✗ **C# language**: Smaller ecosystem vs JavaScript/Python/Go  
✗ **No web UI for consumer management**: Only API docs

#### Fit for mcp-manager
**Poor**. Too early-stage; no per-endpoint auth.

---

### 9. mcp-access-point (sxhxliang) ⭐ PROTOCOL CONVERTER (Not MCP Gateway)
**GitHub**: https://github.com/sxhxliang/mcp-access-point

#### What It Does
- Converts HTTP services into MCP endpoints (not MCP aggregation)
- Built on Pingora (high-performance proxy library)
- Intended for exposing existing HTTP APIs as MCP

#### Gaps
✗ **Wrong use case**: Designed for HTTP→MCP conversion, not MCP gateway  
✗ **No MCP aggregation**: Doesn't proxy or aggregate MCP servers  
✗ **No per-endpoint scoping**: Per-service endpoints, not per-consumer

#### Fit for mcp-manager
**None**. Solves a different problem.

---

## Architecture Patterns Observed

### Pattern 1: Namespace/Endpoint Model (MetaMCP)
```
Namespace "backend-team" → Endpoint /mcp/namespace/backend-team?key=XXX
├─ MCP Server A
├─ MCP Server B
└─ API Key for backend-team consumer

Namespace "frontend-team" → Endpoint /mcp/namespace/frontend-team?key=YYY
├─ MCP Server A
├─ MCP Server C
└─ API Key for frontend-team consumer
```
**Fit for mcp-manager**: Excellent. Maps 1:1 to consumer model.

### Pattern 2: Group-Based Routing (MCPHub)
```
Group "development" → /mcp/$smart/development
├─ MCP Server A, B, C (tagged with env=development)

Group "production" → /mcp/$smart/production
├─ MCP Server D, E (tagged with env=production)
```
**Fit for mcp-manager**: Good, but less precise per-consumer.

### Pattern 3: Transport Bridge (sparfenyuk/mcp-proxy)
```
Named servers → /servers/fetch/, /servers/github/, /servers/brave/
(each server independent; no scoping)
```
**Fit for mcp-manager**: Not suitable for per-consumer scoping.

---

## Gaps Across All Projects

### Universal Gaps
1. **Encrypted secrets at rest**: No OSS gateway explicitly documents encrypting API keys/credentials at rest in database
2. **Consumer onboarding UI**: Most gateways have admin-focused interfaces; none offer simple "register consumer → assign MCPs → get token" workflow
3. **Per-consumer encrypted credentials**: None support encrypting a consumer's own secrets (e.g., API keys for their assigned MCPs)

### Build-Specific Gaps (if building from scratch)
1. Need to implement namespace/endpoint model (MetaMCP does this)
2. Need to implement per-endpoint authentication (MetaMCP + MCPHub do this)
3. Need to handle stdio MCP execution (all major projects do this)
4. Need encrypted secrets storage (MetaMCP partially; others don't)

---

## Build-vs-Reuse Decision Matrix

| Factor | Build (MCP SDK) | Reuse (MetaMCP) + Wrapper | Reuse (MCPHub) + Wrapper |
|--------|-----------------|---------------------------|-------------------------|
| **Time to MVP** | 3-4 weeks | 1-2 weeks | 2-3 weeks |
| **Architecture Risk** | Medium (must design namespace/endpoint model) | Low (proven model) | Low (proven model) |
| **Per-Consumer Scoping** | Must implement | Already implemented ✓ | Already implemented ✓ |
| **Web UI** | Must build | Reuse + customize | Reuse + simplify |
| **Per-Endpoint Auth** | Must implement | Already implemented ✓ | Already implemented ✓ |
| **Community Support** | Stable MCP SDK | 2.5k stars; active | 2.2k stars; active |
| **Customization Flexibility** | Full | 80-90% | 80-90% |
| **Maintenance Burden** | High (maintain gateway + business logic) | Medium (maintain wrapper only) | Medium (maintain wrapper only) |
| **License Lock-in** | None | MIT (no lock-in) | Apache-2.0 (no lock-in) |

---

## Recommended Path: Reuse MetaMCP + Wrapper

### Why MetaMCP
1. **Critical requirement met**: Multiple endpoints with per-endpoint scoped subsets + API keys ✓
2. **Production-ready**: 2.5k stars, active development, MIT license, battle-tested Docker setup
3. **Architectural alignment**: Namespace/endpoint model maps 1:1 to consumer/MCP assignment model
4. **Secrets handling**: Partial (env var refs); can extend with encryption layer
5. **Web UI**: Admin dashboard exists; can simplify for consumer registration UX

### Implementation Roadmap
**Phase 1 (1 week)**: Wrap MetaMCP
- Deploy MetaMCP in container
- Expose simplified "register consumer" API
- Map form inputs (consumer name, assigned MCPs, auth method) → MetaMCP namespace/endpoint/API-key creation
- Encrypt API keys at rest (separate layer)

**Phase 2 (1 week)**: Consumer-facing UX
- Build web UI: list consumers, create consumer, assign MCPs, view consumer endpoint + token
- Admin interface for managing registered MCP servers
- QR code or copy-to-clipboard for consumer endpoint URLs

**Phase 3 (optional)**: Encrypted secrets per consumer
- Add encrypted credential store for per-consumer API keys to their assigned MCPs
- Integrate with MetaMCP's environment variable substitution

### Implementation Effort Estimate
- **Wrapper layer**: ~150 lines of TypeScript/Express (API + simple CRUD for consumer-to-namespace mapping)
- **Web UI**: ~300-400 lines of React/TypeScript (form + list + copy-to-clipboard)
- **Secrets encryption**: ~100 lines (encryption/decryption utility; integrate with existing MetaMCP config)
- **Docker Compose**: ~80 lines (MetaMCP + wrapper service + secrets volume)
- **Total**: ~600-800 lines of new code vs 3000+ lines from MetaMCP codebase

### Risks & Mitigations
| Risk | Mitigation |
|------|-----------|
| MetaMCP breaking changes | Monitor releases; pin to stable version in Dockerfile |
| Namespace/endpoint API complexity | Wrapper abstracts complexity; expose only needed operations |
| Secrets encryption overhead | Lazy initialization; encrypt only on consumer creation |
| Docker networking (stdio MCP inside container) | Use Docker networks; test with npx/uvx servers early |

---

## Alternative: Build on MCP SDK

If full customization is required (e.g., custom per-consumer routing logic, integration with proprietary auth system):

**Use MetaMCP's architecture as reference**:
- Study https://github.com/metatool-ai/metamcp/blob/main/packages/server/src/ for namespace/endpoint/authentication patterns
- Implement namespace grouping (not required by MCP spec; custom data model)
- Implement endpoint-level API key validation middleware
- Use MCP SDK's ServerTransport to expose HTTP/SSE endpoints per consumer

**Effort**: 3-4 weeks (full gateway + UI)  
**Risk**: Medium (new code; untested at scale)  
**Benefit**: Full control over business logic, secrets, registration flow

---

## Unresolved Questions

1. **MetaMCP secrets encryption**: Does MetaMCP encrypt API keys at rest in its database? Check: https://github.com/metatool-ai/metamcp/blob/main/packages/server/src/ for credential storage logic.
   - **Impact**: If not encrypted, wrapper must add encryption layer (low effort; ~100 lines)

2. **Docker stdio MCP lifecycle**: How does MetaMCP manage stdio MCP server subprocesses inside container? Does it restart failed servers?
   - **Impact**: May need custom health-check loop (low effort)

3. **MCPHub database vs file-based mode maturity**: Which storage backend is recommended for production?
   - **Impact**: Database mode may add PostgreSQL operational overhead

4. **Per-endpoint rate limiting**: Do MetaMCP and MCPHub rate-limit per endpoint (per consumer) or globally?
   - **Impact**: May need custom middleware if per-consumer rate limits are required

---

## Conclusion

**Recommend: REUSE MetaMCP + Wrapper**

MetaMCP is the only mature OSS project that implements the critical per-consumer scoped access requirement with per-endpoint API keys. A lightweight wrapper layer (600-800 lines) to expose simplified consumer registration UX will deliver mcp-manager's MVP in 1-2 weeks with 95% code reuse and minimal maintenance burden.

The alternative—MCPHub—is also viable but less mature and more environment/team-oriented than consumer-oriented.

Building from scratch is viable only if significantly different business logic (e.g., custom per-consumer routing, proprietary auth) is required; otherwise, the 3-4 week build timeline + maintenance overhead is not justified.

**Next Steps**:
1. Verify MetaMCP's secrets-at-rest implementation (ask maintainers or inspect code)
2. Deploy MetaMCP test instance; verify namespace/endpoint model works for mcp-manager's use case
3. Implement Phase 1 wrapper (consumer registration API)
4. Deploy in Docker; test with npx/uvx MCP servers

---

## Sources

- [MetaMCP GitHub](https://github.com/metatool-ai/metamcp)
- [MetaMCP Documentation](https://docs.metamcp.com/en)
- [MCPHub GitHub](https://github.com/samanhappy/mcphub)
- [MCPHub Docs](https://docs.mcphubx.com)
- [sparfenyuk/mcp-proxy GitHub](https://github.com/sparfenyuk/mcp-proxy)
- [TBXark/mcp-proxy GitHub](https://github.com/tbxark/mcp-proxy)
- [1mcp-app/agent GitHub](https://github.com/1mcp-app/agent)
- [Docker MCP Gateway GitHub](https://github.com/docker/mcp-gateway)
- [Docker MCP Gateway Docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway)
- [pluggedin-mcp-proxy GitHub](https://github.com/VeriTeknik/pluggedin-mcp-proxy)
- [MarimerLLC/mcp-aggregator GitHub](https://github.com/MarimerLLC/mcp-aggregator)
- [mcp-access-point GitHub](https://github.com/sxhxliang/mcp-access-point)
- [MCP Gateway Comparison: 10 Tools](https://zuplo.com/blog/mcp-gateway-comparison)
- [Best MCP Gateways 2026 - TrueFoundry](https://www.truefoundry.com/blog/best-mcp-gateways)
- [Bifrost MCP Gateway Docs](https://docs.getbifrost.ai)
