# PI-09 — Proxy compression evaluation (no adoption)

Date: 2026-08-04

## Scope and result

This is a documentation-only spike. No Pi provider route, configuration, credential, prompt, or proxy process was changed. The existing plan makes that boundary explicit ([INV-8](2026-08-04-flow-ui-and-token-savings.md#invariants-testable-debugger-attacks-these-reviewer-reviews-them)).

## Current and proposed trust paths

The current local runtime configuration sends Anthropic-provider traffic to **agentrouter.org**. Therefore its operator already receives the request sent to that endpoint. This evaluation did not inspect or assume agentrouter.org's onward routing, retention, or cache behavior.

A local proxy would change the path to `Pi → local proxy → agentrouter.org` (only if the existing upstream were retained). A remotely hosted proxy would add its operator as another network trust edge. In either case, the proxy receives the full request it accepts: model and parameters, system and conversation content, tool definitions and results, attachments represented in the request, cache metadata, and the authorization header intended for that proxy. It also receives the provider response, including tool calls and generated text. If it is configured to forward upstream, it additionally holds or forwards the upstream credential. Loopback binding makes the proxy a local-process trust edge, not a new remote operator; it does not remove the existing agentrouter.org edge.

## OmniRoute RTK + Caveman

**What exists.** OmniRoute `3.8.48` is installed under the separate Hermes tool tree, not in this repository or Pi's route. Its source defaults the stacked mode to `RTK → Caveman` ([source](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/open-sse/services/compression/strategySelector.ts#L686-L710)). RTK is command/tool-output filtering, deduplication, and truncation; Caveman is rule-based prose rewriting. This is a mutating proxy pipeline, not transport compression.

**Savings evidence.** OmniRoute's own README claims 15–95% savings for the stack, about 89% average on tool-heavy sessions, and 78–95% for the stacked preset ([vendor claim](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/README.md#L654-L703)). Those numbers are **not reproduced for Pi**: no Pi request, credential, or real prompt was sent, and no synthetic end-to-end route was configured. They are not a forecast for Pi workloads.

**Prompt-cache effect.** The provider cache depends on unchanged cached prefixes; Anthropic documents that changing any block at or before a cache breakpoint produces a different prefix hash ([primary documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#how-automatic-prefix-checking-works)). OmniRoute RTK explicitly preserves `cache_control`-marked blocks because rewriting one would guarantee a cache miss ([source](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/open-sse/services/compression/engines/rtk/index.ts#L33-L44)). That safeguard does not prove Pi cache stability for the whole transformed request, the existing agentrouter.org hop, or Caveman changes elsewhere in the prefix. Net cache effect for Pi: **unknown until measured**.

**Assessment.** The stack has a real primary artifact and a plausible benefit for repetitive tool output, but it introduces a large local gateway and a transformed prompt path. The published savings are vendor claims, while Pi cache hit rate, fidelity, latency, and failure behavior are unmeasured.

## Headroom

**What exists.** Headroom is assessable: its primary repository is an active Apache-2.0 project that documents a local proxy, library, and MCP server ([repository and README](https://github.com/headroomlabs-ai/headroom)). It claims 60–95% fewer tokens for JSON and 15–20% for coding agents ([vendor claim](https://github.com/headroomlabs-ai/headroom#proof)); those claims are **not reproduced for Pi**. Its README also describes CacheAligner as warning about cache-busting content without rewriting prompts; that is a vendor assertion, not a Pi measurement.

Do not confuse that project with OmniRoute's engine named `headroom`. OmniRoute `3.8.48` contains a distinct Headroom SmartCrusher implementation that compacts eligible JSON arrays and sends the compact representation to the provider as-is ([source](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/open-sse/services/compression/engines/headroom/index.ts#L1-L15)); its decoder has no production caller ([source](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/open-sse/services/compression/engines/headroom/index.ts#L182-L187)). Thus it can also change cache-key input despite being described as lossless after local reconstruction.

**Prompt-cache effect.** Any Headroom mode that changes content before a cache breakpoint can invalidate a provider cache prefix under Anthropic's documented rule. Whether its cache-aware exclusions preserve Pi's actual prefix, and whether agentrouter.org preserves the cache protocol, are **unknown**. No Headroom artifact is installed or wired into Pi.

## Minimum further spike (requires a new decision)

Before considering adoption, run an isolated, loopback-only experiment with synthetic requests and disposable credentials only. Compare direct versus proxy for the same fixed prefix and tool output: upstream cache-read/create usage, request bytes/tokens, latency, response fidelity, and fail-open behavior. Record the exact proxy version and configuration; do not route Pi's normal traffic until the result shows no unacceptable cache regression or trust-boundary change.

## Sources

- Pi plan and adoption boundary: [`2026-08-04-flow-ui-and-token-savings.md`](2026-08-04-flow-ui-and-token-savings.md#adoption-boundary).
- OmniRoute primary source, installed artifact evaluated: `omniroute@3.8.48`; [README savings claim](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/README.md#L654-L703), [stack default](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/open-sse/services/compression/strategySelector.ts#L686-L710), and [RTK cache guard](https://github.com/diegosouzapw/OmniRoute/blob/v3.8.48/open-sse/services/compression/engines/rtk/index.ts#L33-L44).
- Headroom primary source: [project README](https://github.com/headroomlabs-ai/headroom) (proxy capability and vendor benchmarks).
- Provider cache behavior: [Anthropic prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#how-automatic-prefix-checking-works).

Verdict: needs a further spike
