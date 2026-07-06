# Slash Commands

Slash commands are deterministic UI commands handled before normal chat input is sent to the LLM.

## Structure

- `src/commands/command.ts` defines command types and result intents.
- `src/commands/command-registry.ts` stores commands, resolves aliases, parses args, and dispatches slash input.
- `src/commands/builtin/*` contains individual built-in commands.
- `src/commands/create-command-registry.ts` wires the default command set.
- `src/cli/chat-loop.tsx` interprets command results and updates the TUI.

## Flow

1. User submits input in the TUI.
2. Chat loop checks the command registry first.
3. Non-slash input returns `{ handled: false }` and goes to `AgentSession.chat()`.
4. Slash input returns a command result intent.
5. The TUI performs the intent without adding command output to LLM history.

## Result Types

- `message`: show deterministic output in the TUI.
- `submit`: turn command output into a normal user message.
- `alias`: re-submit another input string.
- `exit`: close the chat loop.

## Built-ins

- `/help`, `/h`: show available commands.
- `/context`: show current context usage.
- `/compact`: compact conversation context manually. See `docs/compaction.md`.
- `/skills [query]`: list loaded skills.
- `/session`: show current session metadata.
