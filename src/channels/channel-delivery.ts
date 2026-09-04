import type { ChannelAdapter, ChannelOutput } from "./channel";

export class ChannelDelivery {
	private readonly adaptersByName: ReadonlyMap<string, ChannelAdapter>;

	constructor(adapters: readonly ChannelAdapter[]) {
		const entries = adapters.map((adapter) => [adapter.name, adapter] as const);

		if (new Set(entries.map(([name]) => name)).size !== entries.length) {
			throw new Error("Channel adapter names must be unique.");
		}

		this.adaptersByName = new Map(entries);
	}

	async send(output: ChannelOutput): Promise<void> {
		const adapter = this.adaptersByName.get(output.target.channel);

		if (adapter === undefined) {
			throw new Error(
				`No channel adapter is registered for ${output.target.channel}.`,
			);
		}

		await adapter.send(output);
	}
}
