export class ChannelDeliveryError extends Error {
	constructor(
		readonly channel: string,
		options?: ErrorOptions,
	) {
		super(`Failed to deliver message through ${channel}.`, options);
		this.name = "ChannelDeliveryError";
	}
}
