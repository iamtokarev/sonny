import type { ContextUsage, PreparedContext } from "../context";
import type { HistorySession } from "../history";
import type { RuntimeConfigurationResult } from "../runtime";
import type { Skill } from "../skills/skill";

export interface SlashCommandContext {
	historySession: HistorySession;
	skills: Skill[];
	getMessageCount(): number;
	getContextUsage(): ContextUsage;
	compactContext(): Promise<PreparedContext>;
	reloadConfiguration(): Promise<RuntimeConfigurationResult>;
}

export interface SlashCommand {
	name: string;
	description: string;
	aliases?: string[];
	usage?: string;
	execute(
		args: string,
		context: SlashCommandContext,
	): SlashCommandResult | Promise<SlashCommandResult>;
	channelControl?(args: string): ChannelControlIntent | undefined;
}

export type ChannelControlIntent = "new-session";

export type SlashCommandResult =
	| {
			type: "message";
			content: string;
	  }
	| {
			type: "submit";
			content: string;
			notice?: string;
	  }
	| {
			type: "alias";
			input: string;
	  }
	| {
			type: "exit";
			content?: string;
	  }
	| {
			type: "channel-control";
			intent: ChannelControlIntent;
	  };

export type SlashCommandDispatchResult =
	| { handled: false }
	| { handled: true; result: SlashCommandResult };
