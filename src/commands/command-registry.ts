import type {
	ChannelControlIntent,
	SlashCommand,
	SlashCommandContext,
	SlashCommandDispatchResult,
} from "./command";

export interface ChannelControlMatch {
	readonly commandName: string;
	readonly intent: ChannelControlIntent;
}

export class CommandRegistry {
	private readonly commands = new Map<string, SlashCommand>();
	private readonly aliases = new Map<string, string>();

	register(command: SlashCommand): void {
		if (this.commands.has(command.name)) {
			throw new Error(`Command already registered: /${command.name}`);
		}

		if (this.aliases.has(command.name)) {
			throw new Error(`Command name conflicts with alias: /${command.name}`);
		}

		this.commands.set(command.name, command);

		for (const alias of command.aliases ?? []) {
			if (this.commands.has(alias) || this.aliases.has(alias)) {
				throw new Error(`Command alias already registered: /${alias}`);
			}

			this.aliases.set(alias, command.name);
		}
	}

	list(): SlashCommand[] {
		return Array.from(this.commands.values());
	}

	matchChannelControl(input: string): ChannelControlMatch | undefined {
		const resolved = this.resolve(input);

		if (
			resolved === undefined ||
			resolved.command?.channelControl === undefined
		) {
			return undefined;
		}

		const intent = resolved.command.channelControl(resolved.args);

		return intent === undefined
			? undefined
			: { commandName: resolved.rawName, intent };
	}

	async dispatch(
		input: string,
		context: SlashCommandContext,
	): Promise<SlashCommandDispatchResult> {
		const resolved = this.resolve(input);

		if (resolved === undefined) {
			return { handled: false };
		}

		const { rawName: name, command, args } = resolved;

		if (command === undefined) {
			return {
				handled: true,
				result: {
					type: "message",
					content: `Unknown command: /${name}`,
				},
			};
		}

		return {
			handled: true,
			result: await command.execute(args, context),
		};
	}

	private resolve(input: string):
		| {
				readonly rawName: string;
				readonly commandName: string;
				readonly command?: SlashCommand;
				readonly args: string;
		  }
		| undefined {
		const trimmed = input.trim();

		if (!trimmed.startsWith("/")) {
			return undefined;
		}

		const [rawName = "", ...argParts] = trimmed.slice(1).split(/\s+/);
		const name = rawName.trim();

		if (name.length === 0) {
			return undefined;
		}

		const commandName = this.aliases.get(name) ?? name;

		return {
			rawName: name,
			commandName,
			command: this.commands.get(commandName),
			args: argParts.join(" "),
		};
	}
}
