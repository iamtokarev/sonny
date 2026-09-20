import {
	type CreateChannelGatewayOptions,
	createChannelGateway,
} from "../channels/create-channel-gateway";
import { InMemoryRuntimeEventBus, type RuntimeEventBus } from "../events";
import type { RuntimeConfigStore } from "../runtime";
import { createLogger, type Logger } from "../utils/logger";

const logger = createLogger("cli.gateway");

type GatewaySignal = "SIGINT" | "SIGTERM";

export interface GatewaySignalSource {
	once(signal: GatewaySignal, listener: () => void): void;
	off(signal: GatewaySignal, listener: () => void): void;
}

export interface GatewayTerminal {
	writeLine(message: string): void;
}

interface RunnableGateway {
	run(signal: AbortSignal): Promise<void>;
}

type CreateGateway = (
	options: CreateChannelGatewayOptions,
) => Promise<RunnableGateway>;

export interface RunGatewayCommandOptions {
	readonly configStore: RuntimeConfigStore;
	readonly events?: RuntimeEventBus;
	readonly createGateway?: CreateGateway;
	readonly signals?: GatewaySignalSource;
	readonly logger?: Logger;
	readonly terminal?: GatewayTerminal;
}

const processSignals: GatewaySignalSource = {
	once: (signal, listener) => {
		process.once(signal, listener);
	},
	off: (signal, listener) => {
		process.off(signal, listener);
	},
};

const processTerminal: GatewayTerminal = {
	writeLine: (message) => console.log(message),
};

export async function runGatewayCommand(
	options: RunGatewayCommandOptions,
): Promise<void> {
	const startupConfig = options.configStore.current.config;
	const enabledChannels = startupConfig.channels.telegram.enabled
		? ["telegram"]
		: [];
	const terminal = options.terminal ?? processTerminal;
	terminal.writeLine(
		`Starting Sonny gateway (${enabledChannels.join(", ") || "no channels"}; long-polling). Press Ctrl-C to stop.`,
	);
	const events = options.events ?? new InMemoryRuntimeEventBus();
	const gateway = await (options.createGateway ?? createChannelGateway)({
		configStore: options.configStore,
		events,
	});
	const abort = new AbortController();
	const signals = options.signals ?? processSignals;
	const commandLogger = options.logger ?? logger;
	const stop = () => abort.abort();

	signals.once("SIGINT", stop);
	signals.once("SIGTERM", stop);

	commandLogger.info("channel.gateway.started", {
		enabledChannels,
		mode: "long-polling",
		telegramAllowlistCount:
			startupConfig.channels.telegram.allowedUserIds.length,
		channelConfiguration: "restart-required",
	});

	try {
		await gateway.run(abort.signal);
	} finally {
		signals.off("SIGINT", stop);
		signals.off("SIGTERM", stop);
		commandLogger.info("channel.gateway.stopped", {
			enabledChannels,
		});
	}
}
