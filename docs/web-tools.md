# Web Tools

Sonny provides two optional web tools backed by Tavily:

- `webSearch`: returns result titles, URLs, and snippets.
- `webRead`: extracts one page as Markdown.

They are registered only when `TAVILY_API_KEY` is available.

## Structure

- `src/web/*`: provider-neutral interfaces and the Tavily adapter.
- `src/tools/builtin/web-*-tool.ts`: model-facing validation and `ToolResult` conversion.
- `src/tools/policies/web-url-policy.ts`: URL destination policy.
- `src/tools/hooks/web-url-policy-hooks.ts`: applies policy before approval and execution.

One `TavilyWebProvider` implements both `WebSearchProvider` and
`WebReadProvider`. The tools depend on the interfaces, not the Tavily SDK.

## Flow

1. The model calls `webSearch` or `webRead`.
2. Tool parameters pass through pre-tool policy and HITL approval.
3. The tool validates parameters and calls its provider interface.
4. The Tavily adapter normalizes SDK responses into Sonny types.
5. The tool returns JSON to the model; provider failures become failed tool results.

`webSearch` uses basic general search without generated answers, raw page
content, or images. `webRead` uses basic Markdown extraction without images.

## URL Safety

Before `webRead`, Sonny rejects URL credentials, localhost and metadata hosts,
and literal non-public IPv4/IPv6 destinations. Malformed URLs remain tool
validation errors rather than policy denials.

DNS rebinding and redirect validation are outside the V1 policy.
