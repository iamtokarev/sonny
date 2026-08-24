import {
	type ConfigRefreshResult,
	type ConfigReloadError,
	type ConfigSection,
	type ConfigSnapshot,
	diffConfigSections,
	type ResolvedConfig,
	toSafeConfigError,
} from "../config";
import type { ContextUsage, PreparedContext } from "../context";
import type { TurnContext } from "../events";
import type { AgentRuntimeSession } from "./agent-runtime";
import { createRuntimeConfigSignature } from "./runtime-config-signature";

export interface RuntimeInfo {
	readonly model: string;
	readonly toolNames: readonly string[];
}

export interface BuiltAgentSession {
	readonly session: AgentRuntimeSession;
	readonly info: RuntimeInfo;
}

export type AgentSessionBuilder = (config: ResolvedConfig) => BuiltAgentSession;

export interface RuntimeConfigStore {
	readonly current: ConfigSnapshot;
	refresh(options?: { readonly force?: boolean }): Promise<ConfigRefreshResult>;
}

export type RuntimeConfigurationResult =
	| {
			readonly status: "unchanged";
			readonly revision: number;
			readonly info: RuntimeInfo;
	  }
	| {
			readonly status: "reloaded";
			readonly revision: number;
			readonly changedSections: readonly ConfigSection[];
			readonly runtimeRebuilt: boolean;
			readonly info: RuntimeInfo;
	  }
	| {
			readonly status: "rejected";
			readonly retainedRevision: number;
			readonly phase: "load" | "apply";
			readonly error: ConfigReloadError;
	  };

export interface ConfigurableAgentRuntimeSession extends AgentRuntimeSession {
	refreshConfiguration(options?: {
		readonly force?: boolean;
	}): Promise<RuntimeConfigurationResult>;
}

export class ReloadableAgentSession implements ConfigurableAgentRuntimeSession {
	private appliedSignature: string;
	private rejectedApplyRevision?: number;

	constructor(
		private readonly configStore: RuntimeConfigStore,
		private readonly builder: AgentSessionBuilder,
		private appliedSnapshot: ConfigSnapshot,
		private active: BuiltAgentSession,
	) {
		this.appliedSignature = createRuntimeConfigSignature(
			appliedSnapshot.config,
		);
	}

	chat(message: string, turnContext: TurnContext): Promise<string> {
		return this.active.session.chat(message, turnContext);
	}

	getMessageCount(): number {
		return this.active.session.getMessageCount();
	}

	getContextUsage(): ContextUsage {
		return this.active.session.getContextUsage();
	}

	compactContext(turnContext: TurnContext): Promise<PreparedContext> {
		return this.active.session.compactContext(turnContext);
	}

	async refreshConfiguration(
		options: { readonly force?: boolean } = {},
	): Promise<RuntimeConfigurationResult> {
		const refresh = await this.configStore.refresh(options);

		if (refresh.status === "rejected") {
			return {
				status: "rejected",
				retainedRevision: this.appliedSnapshot.revision,
				phase: "load",
				error: refresh.error,
			};
		}

		const candidate = refresh.snapshot;
		if (candidate.revision === this.appliedSnapshot.revision) {
			return this.unchanged();
		}

		const changedSections = diffConfigSections(
			this.appliedSnapshot.config,
			candidate.config,
		);
		const candidateSignature = createRuntimeConfigSignature(candidate.config);

		if (candidateSignature === this.appliedSignature) {
			this.appliedSnapshot = candidate;
			this.rejectedApplyRevision = undefined;

			return {
				status: "reloaded",
				revision: candidate.revision,
				changedSections,
				runtimeRebuilt: false,
				info: this.active.info,
			};
		}

		if (
			options.force !== true &&
			this.rejectedApplyRevision === candidate.revision
		) {
			return this.unchanged();
		}

		try {
			const replacement = this.builder(candidate.config);

			this.active = replacement;
			this.appliedSnapshot = candidate;
			this.appliedSignature = candidateSignature;
			this.rejectedApplyRevision = undefined;

			return {
				status: "reloaded",
				revision: candidate.revision,
				changedSections,
				runtimeRebuilt: true,
				info: replacement.info,
			};
		} catch (error) {
			this.rejectedApplyRevision = candidate.revision;

			return {
				status: "rejected",
				retainedRevision: this.appliedSnapshot.revision,
				phase: "apply",
				error: toSafeConfigError(error),
			};
		}
	}

	private unchanged(): RuntimeConfigurationResult {
		return {
			status: "unchanged",
			revision: this.appliedSnapshot.revision,
			info: this.active.info,
		};
	}
}
