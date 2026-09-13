# Files

- [Sonny channel gateway workflow](channel-gateway-workflow.md) - Describes how the gateway CLI command starts channels, how inbound messages and approval actions flow through SessionInteractor into the agent runtime, how /new resets a conversation, and how shutdown drains work safely.
- [Sonny chat and command workflow](chat-and-commands.md) - Describes how the interactive TUI handles user input, slash commands, session selection, tool approvals, config hot-reload polling and the /reload command, and resume/continue behavior. Also notes the shared SessionInteractor input path used by the channel gateway.
