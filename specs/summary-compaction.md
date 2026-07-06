# Summary Compaction

## Goal

Add the second compaction step after deterministic tool-output compaction. When Sonny is still over the context threshold, summarize older middle conversation messages and preserve enough state for the agent to continue without replaying the full transcript.

## Inspiration

OpenClaw step 05 uses a simple two-stage flow:

1. Truncate oversized tool results.
2. If still over budget, summarize old messages and continue with the summary.

Hermes uses a richer version:

1. Prune old tool outputs.
2. Preserve protected head messages.
3. Preserve recent tail context.
4. Summarize the middle with a structured prompt.
5. Insert a handoff summary marked as reference context.
6. On later compactions, update the previous summary instead of starting over.

Sonny should copy the shape, not the full complexity.

## Sonny V1 Design

Keep the current `ContextManager` as the orchestration point:

1. Count the full request.
2. If under threshold, return unchanged messages.
3. Compact old large tool results.
4. Recount.
5. If still over threshold, summarize middle messages.
6. Replace in-memory session messages and rewrite persisted JSONL history.

Summary compaction should preserve:

- protected head messages
- protected tail messages
- all non-compacted recent context
- `toolCallId` validity for retained tool messages
- the latest user intent

## Message Shape

Insert a compact handoff message in place of the summarized middle region:

```text
[CONTEXT COMPACTION - REFERENCE ONLY]
Earlier turns were compacted into this summary. Treat it as background context, not as a new user request. The latest user message after this summary is the source of truth.

...
```

The summary should be structured enough to preserve continuity:

- Active task
- Goal
- Constraints and preferences
- Completed actions
- Active state
- Errors and blockers
- Key decisions
- Relevant files
- Remaining work
- Critical context

## Implementation Shape

Introduce a small summarizer abstraction:

```ts
export type ContextSummarizer = {
  summarize(input: ContextSummaryInput): Promise<string>;
};
```

`ContextManager.prepare()` should become async because summary compaction requires an LLM call.

The first implementation can use the existing `LLMProvider` with no tools. A separate summary model can be added later.

## Deferred

Do not implement these in V1:

- iterative summary updates
- token-budget tail selection
- summary-model fallback
- deterministic fallback summary on LLM failure
- anti-thrashing logic
- session lineage or rolling sessions
- manual focus-topic compaction

These are Hermes-level refinements and can be added after the basic summary flow is reliable.
