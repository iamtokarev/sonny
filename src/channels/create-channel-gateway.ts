import { join } from "node:path";
import { createDefaultCommandRegistry } from "../commands/create-command-registry";
import type { ResolvedConfig } from "../config";
import type { RuntimeEventBus } from "../events";
import {
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	createAgentSession,
	type RuntimeConfigStore,
} from "../runtime";
import type { ChannelAdapter, ChannelSource } from "./channel";
import { ChannelApprovalBroker } from "./channel-approval-broker";
import { ChannelDelivery } from "./channel-delivery";
import { ChannelGateway } from "./channel-gateway";
import { ChannelSessionBindingStore } from "./channel-session-binding-store";
import { ChannelSessionDirectory } from "./channel-session-directory";
import { type EnabledTelegramChannelConfig, TelegramAdapter } from "./telegram";

export interface CreateChannelGatewayOptions {
	readonly configStore: RuntimeConfigStore;
	readonly events: RuntimeEventBus;
}

type CreateTelegramAdapter = (
	config: EnabledTelegramChannelConfig,
) => ChannelAdapter;

type CreateSession = (
	options: CreateAgentSessionOptions,
) => Promise<CreateAgentSessionResult>;

interface CreateChannelGatewayDependencies {
	readonly createTelegramAdapter: CreateTelegramAdapter;
	readonly createSession: CreateSession;
}

const defaultDependencies: CreateChannelGatewayDependencies = {
	createTelegramAdapter: (config) => new TelegramAdapter(config),
	createSession: createAgentSession,
};

/** @internal */
export function createChannelAccessCheck(
	config: ResolvedConfig,
): (source: ChannelSource) => boolean {
	const telegramUsers = new Set(config.channels.telegram.allowedUserIds);

	return (source) => {
		if (source.channel === "telegram") {
			return telegramUsers.has(source.userId);
		}

		return false;
	};
}

export async function createChannelGateway(
	options: CreateChannelGatewayOptions,
	dependencies: Partial<CreateChannelGatewayDependencies> = {},
): Promise<ChannelGateway> {
	const resolvedDependencies = { ...defaultDependencies, ...dependencies };
	const config = options.configStore.current.config;
	const adapters: ChannelAdapter[] = [];
	const telegram = config.channels.telegram;

	if (telegram.enabled) {
		if (telegram.botToken === undefined) {
			throw new Error(
				"Telegram configuration was enabled without a bot token.",
			);
		}

		adapters.push(
			resolvedDependencies.createTelegramAdapter({
				...telegram,
				enabled: true,
				botToken: telegram.botToken,
			}),
		);
	}

	if (adapters.length === 0) {
		throw new Error("No channels are enabled.");
	}

	const delivery = new ChannelDelivery(adapters);
	const approvals = new ChannelApprovalBroker((output) =>
		delivery.send(output),
	);
	const bindings = new ChannelSessionBindingStore(
		join(config.workspace, ".history", "channels", "bindings.json"),
	);
	const commands = createDefaultCommandRegistry();
	const sessions = new ChannelSessionDirectory(
		bindings,
		({ resumeSessionId }) =>
			resolvedDependencies.createSession({
				configStore: options.configStore,
				events: options.events,
				approveToolCall: (request) => approvals.request(request),
				resumeSessionId,
			}),
		commands,
	);

	return new ChannelGateway({
		adapters,
		delivery,
		sessions,
		approvals,
		isAllowed: createChannelAccessCheck(config),
	});
}
