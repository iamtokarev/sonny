import { stat } from "node:fs/promises";
import { type ConfigSection, diffConfigSections } from "./config-diff";
import { type ConfigReloadError, toSafeConfigError } from "./config-error";
import { loadConfig } from "./load-config";
import type { Config, ContextCompactionConfig, LLMConfig } from "./schemas";

export type ResolvedConfig = Readonly<
	Omit<Config, "llm" | "contextCompaction"> & {
		readonly llm: Readonly<LLMConfig>;
		readonly contextCompaction: Readonly<ContextCompactionConfig>;
	}
>;

export interface ConfigSnapshot {
	readonly revision: number;
	readonly loadedAt: Date;
	readonly config: ResolvedConfig;
}

export interface ConfigStoreOptions {
	readonly configPath: string;
	readonly envPath?: string;
}

export type ConfigRefreshResult =
	| {
			readonly status: "unchanged";
			readonly snapshot: ConfigSnapshot;
	  }
	| {
			readonly status: "reloaded";
			readonly snapshot: ConfigSnapshot;
			readonly changedSections: readonly ConfigSection[];
	  }
	| {
			readonly status: "rejected";
			readonly snapshot: ConfigSnapshot;
			readonly error: ConfigReloadError;
	  };

interface SourceFingerprint {
	readonly config: string;
	readonly environment: string;
}

function deepFreeze<T>(value: T): Readonly<T> {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);

		for (const child of Object.values(value as Record<string, unknown>)) {
			deepFreeze(child);
		}
	}

	return value as Readonly<T>;
}

async function fingerprint(path: string, required: boolean): Promise<string> {
	try {
		const metadata = await stat(path, { bigint: true });
		return `${metadata.mtimeNs}:${metadata.size}`;
	} catch (error) {
		if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") {
			return "missing";
		}

		throw error;
	}
}

async function fingerprintSources(
	options: ConfigStoreOptions,
): Promise<SourceFingerprint> {
	return {
		config: await fingerprint(options.configPath, true),
		environment:
			options.envPath === undefined
				? "disabled"
				: await fingerprint(options.envPath, false),
	};
}

function fingerprintsEqual(
	left: SourceFingerprint,
	right: SourceFingerprint,
): boolean {
	return left.config === right.config && left.environment === right.environment;
}

function configsEqual(left: ResolvedConfig, right: ResolvedConfig): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export class ConfigStore {
	private refreshTail: Promise<void> = Promise.resolve();

	private constructor(
		private readonly options: ConfigStoreOptions,
		private snapshot: ConfigSnapshot,
		private observedFingerprint: SourceFingerprint,
	) {}

	static async open(options: ConfigStoreOptions): Promise<ConfigStore> {
		try {
			const config = deepFreeze(
				await loadConfig(options.configPath, options.envPath),
			) as ResolvedConfig;
			const sourceFingerprint = await fingerprintSources(options);

			return new ConfigStore(
				options,
				{ revision: 1, loadedAt: new Date(), config },
				sourceFingerprint,
			);
		} catch (error) {
			throw toSafeConfigError(error);
		}
	}

	get current(): ConfigSnapshot {
		return this.snapshot;
	}

	refresh(
		options: { readonly force?: boolean } = {},
	): Promise<ConfigRefreshResult> {
		const run = this.refreshTail.then(() =>
			this.refreshNow(options.force ?? false),
		);

		this.refreshTail = run.then(
			() => undefined,
			() => undefined,
		);

		return run;
	}

	private async refreshNow(force: boolean): Promise<ConfigRefreshResult> {
		let nextFingerprint: SourceFingerprint;

		try {
			nextFingerprint = await fingerprintSources(this.options);
		} catch (error) {
			return this.reject(error);
		}

		if (
			!force &&
			fingerprintsEqual(nextFingerprint, this.observedFingerprint)
		) {
			return { status: "unchanged", snapshot: this.snapshot };
		}

		this.observedFingerprint = nextFingerprint;

		try {
			const nextConfig = deepFreeze(
				await loadConfig(this.options.configPath, this.options.envPath),
			) as ResolvedConfig;

			if (configsEqual(this.snapshot.config, nextConfig)) {
				return { status: "unchanged", snapshot: this.snapshot };
			}

			const changedSections = diffConfigSections(
				this.snapshot.config,
				nextConfig,
			);
			this.snapshot = {
				revision: this.snapshot.revision + 1,
				loadedAt: new Date(),
				config: nextConfig,
			};

			return {
				status: "reloaded",
				snapshot: this.snapshot,
				changedSections,
			};
		} catch (error) {
			return this.reject(error);
		}
	}

	private reject(error: unknown): ConfigRefreshResult {
		return {
			status: "rejected",
			snapshot: this.snapshot,
			error: toSafeConfigError(error),
		};
	}
}
