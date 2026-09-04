import type {
	SlashCommandContext,
	SlashCommandResult,
} from "../commands/command";
import type { CommandRegistry } from "../commands/command-registry";
import type { RuntimeSource } from "../events";
import type { CreateAgentSessionResult } from "../runtime";

export interface SessionInteractionInput {
	readonly content: string;
	readonly source: RuntimeSource;
	readonly signal?: AbortSignal;
}

export type SessionInteractionMessage =
	| {
			readonly kind: "assistant";
			readonly content: string;
	  }
	| {
			readonly kind: "command";
			readonly commandName: string;
			readonly content: string;
	  }
	| {
			readonly kind: "notice";
			readonly content: string;
	  };

export interface SessionInteractionResult {
	readonly messages: readonly SessionInteractionMessage[];
	readonly exitRequested: boolean;
}

export type InteractorSession = Pick<
	CreateAgentSessionResult,
	"runtime" | "historySession" | "skills"
>;

const maxAliasResolutions = 5;

function commandNameFrom(input: string): string {
	return input.slice(1).split(/\s+/, 1)[0] ?? "";
}

/**
 * Owns input ordering and command semantics shared by every conversation UI.
 * Runtime operations keep their own queue; this queue also covers synchronous
 * commands, so a quick inspection cannot overtake an earlier user message.
 */
export class SessionInteractor {
	private tail: Promise<void> = Promise.resolve();

	constructor(
		private readonly session: InteractorSession,
		private readonly commands: CommandRegistry,
	) {}

	handle(input: SessionInteractionInput): Promise<SessionInteractionResult> {
		const run = this.tail.then(() => this.handleNow(input, 0));

		this.tail = run.then(
			() => undefined,
			() => undefined,
		);

		return run;
	}

	private async handleNow(
		input: SessionInteractionInput,
		aliasResolutions: number,
	): Promise<SessionInteractionResult> {
		const content = input.content.trim();

		if (content.startsWith("/")) {
			const dispatched = await this.commands.dispatch(
				content,
				this.buildCommandContext(input.source),
			);

			if (dispatched.handled) {
				return this.handleCommandResult(
					commandNameFrom(content),
					dispatched.result,
					input,
					aliasResolutions,
				);
			}
		}

		return this.runTurn(content, input);
	}

	private buildCommandContext(source: RuntimeSource): SlashCommandContext {
		return {
			historySession: this.session.historySession,
			skills: this.session.skills,
			getMessageCount: () => this.session.runtime.getMessageCount(),
			getContextUsage: () => this.session.runtime.getContextUsage(source),
			compactContext: () => this.session.runtime.compactContext({ source }),
			reloadConfiguration: () =>
				this.session.runtime.reloadConfiguration({ force: true, source }),
		};
	}

	private async handleCommandResult(
		commandName: string,
		result: SlashCommandResult,
		input: SessionInteractionInput,
		aliasResolutions: number,
	): Promise<SessionInteractionResult> {
		switch (result.type) {
			case "message":
				return {
					messages: [{ kind: "command", commandName, content: result.content }],
					exitRequested: false,
				};

			case "submit": {
				const turn = await this.runTurn(result.content, input);
				const notices: SessionInteractionMessage[] =
					result.notice === undefined
						? []
						: [{ kind: "notice", content: result.notice }];

				return {
					messages: [...notices, ...turn.messages],
					exitRequested: false,
				};
			}

			case "alias":
				if (aliasResolutions >= maxAliasResolutions) {
					throw new Error(
						`Command alias resolution exceeded ${maxAliasResolutions} resolutions.`,
					);
				}

				return this.handleNow(
					{ ...input, content: result.input },
					aliasResolutions + 1,
				);

			case "exit":
				return {
					messages:
						result.content === undefined
							? []
							: [
									{
										kind: "command",
										commandName,
										content: result.content,
									},
								],
					exitRequested: true,
				};
		}
	}

	private async runTurn(
		content: string,
		input: SessionInteractionInput,
	): Promise<SessionInteractionResult> {
		const result = await this.session.runtime.runTurn({
			content,
			source: input.source,
			signal: input.signal,
		});

		return {
			messages: [{ kind: "assistant", content: result.content }],
			exitRequested: false,
		};
	}
}
