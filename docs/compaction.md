# Context Compaction

Sonny compacts conversation history before LLM calls when the estimated request size crosses the configured threshold.

## Flow

1. Build the request from the system prompt, current messages, and tool schemas.
2. Estimate tokens with `GptTokenizerTokenCounter`.
3. If below threshold, keep messages unchanged.
4. If over threshold, compact old large `tool` messages first.
5. If still over threshold, summarize the middle of the conversation with the LLM.
6. Replace in-memory messages and rewrite persisted JSONL history when compaction changed the session.

## Protected Messages

Compaction keeps the beginning and end of the conversation intact:

- `protectedHeadMessages`: earliest messages to preserve.
- `protectedTailMessages`: latest messages to preserve.

The middle region is the only part eligible for summary compaction.

## Tool Output Compaction

Large old tool results are shortened to `maxToolResultChars` and marked with:

```text
[Tool output compacted: original length N characters.]
```

Already compacted tool results are skipped.

## Summary Compaction

Summary compaction replaces the eligible middle messages with one synthetic summary message headed by:

```text
[CONTEXT COMPACTION - REFERENCE ONLY]
```

The summary preserves active task state, constraints, decisions, relevant files, errors, and remaining work. Tool-call pairs are sanitized so assistant tool calls and tool results remain structurally valid.

## Manual Commands

- `/context`: inspect current message count and estimated token usage.
- `/compact`: force the compaction pipeline manually, even below the automatic threshold when there is a safe middle region.

Slash command output is UI-only and is not added to LLM history.

## Config

Defaults live under `contextCompaction`:

```yaml
contextCompaction:
  contextWindowTokens: 200000
  thresholdRatio: 0.75
  maxToolResultChars: 10000
  protectedHeadMessages: 4
  protectedTailMessages: 6
  summaryMaxTokens: 4000
```
