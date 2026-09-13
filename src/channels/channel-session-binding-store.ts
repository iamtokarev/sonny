import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ChannelConversationKind, ChannelSource } from "./channel";

export interface ChannelSessionBinding {
	readonly key: string;
	readonly channel: string;
	readonly conversationId: string;
	readonly conversationKind: ChannelConversationKind;
	readonly threadId?: string;
	readonly sessionId: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

const ChannelSessionBindingSchema = z
	.object({
		key: z.string().min(1),
		channel: z.string().min(1),
		conversationId: z.string().min(1),
		conversationKind: z.enum(["direct", "group", "channel"]),
		threadId: z.string().min(1).optional(),
		sessionId: z.string().min(1),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.strict();

const ChannelSessionBindingsSchema = z
	.array(ChannelSessionBindingSchema)
	.superRefine((bindings, context) => {
		const keys = new Set<string>();

		for (const [index, binding] of bindings.entries()) {
			if (binding.key !== createBindingKey(binding)) {
				context.addIssue({
					code: "custom",
					path: [index, "key"],
					message: "Binding key does not match its routing fields.",
				});
			}

			if (keys.has(binding.key)) {
				context.addIssue({
					code: "custom",
					path: [index, "key"],
					message: "Binding keys must be unique.",
				});
			}

			keys.add(binding.key);
		}
	});

export type ChannelSessionKeySource = Pick<
	ChannelSource,
	"channel" | "conversationKind" | "conversationId" | "threadId"
>;

function createBindingKey(source: ChannelSessionKeySource): string {
	return [
		source.channel,
		source.conversationKind,
		source.conversationId,
		source.threadId ?? "-",
	]
		.map((part) => encodeURIComponent(part))
		.join(":");
}

export function createChannelSessionKey(
	source: ChannelSessionKeySource,
): string {
	return createBindingKey(source);
}

function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class ChannelSessionBindingStore {
	private tail: Promise<void> = Promise.resolve();

	constructor(
		private readonly filePath: string,
		private readonly now: () => Date = () => new Date(),
	) {}

	get(source: ChannelSource): Promise<ChannelSessionBinding | undefined> {
		return this.enqueue(async () => {
			const key = createChannelSessionKey(source);
			const bindings = await this.readBindings();

			return bindings.find((binding) => binding.key === key);
		});
	}

	bind(
		source: ChannelSource,
		sessionId: string,
	): Promise<ChannelSessionBinding> {
		return this.enqueue(async () => {
			const key = createChannelSessionKey(source);
			const bindings = await this.readBindings();
			const existing = bindings.find((binding) => binding.key === key);
			const now = this.now().toISOString();
			const binding: ChannelSessionBinding = {
				key,
				channel: source.channel,
				conversationId: source.conversationId,
				conversationKind: source.conversationKind,
				...(source.threadId === undefined ? {} : { threadId: source.threadId }),
				sessionId,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};
			const next = existing
				? bindings.map((candidate) =>
						candidate.key === key ? binding : candidate,
					)
				: [...bindings, binding];

			await this.writeBindings(next);

			return binding;
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.tail.then(operation);

		this.tail = run.then(
			() => undefined,
			() => undefined,
		);

		return run;
	}

	private async readBindings(): Promise<ChannelSessionBinding[]> {
		let content: string;

		try {
			content = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isMissingFile(error)) {
				return [];
			}

			throw error;
		}

		try {
			return ChannelSessionBindingsSchema.parse(JSON.parse(content));
		} catch (error) {
			throw new Error("Channel session bindings are malformed.", {
				cause: error,
			});
		}
	}

	private async writeBindings(
		bindings: ChannelSessionBinding[],
	): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;

		try {
			await writeFile(temporaryPath, `${JSON.stringify(bindings, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
			});
			await rename(temporaryPath, this.filePath);
		} catch (error) {
			try {
				await unlink(temporaryPath);
			} catch (cleanupError) {
				if (!isMissingFile(cleanupError)) {
					throw new AggregateError(
						[error, cleanupError],
						"Failed to persist channel session bindings and remove the temporary file.",
					);
				}
			}

			throw error;
		}
	}
}
