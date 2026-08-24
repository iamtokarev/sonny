export class ConfigReloadError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ConfigReloadError";
	}
}

export function toSafeConfigError(error: unknown): ConfigReloadError {
	if (error instanceof ConfigReloadError) {
		return error;
	}

	return new ConfigReloadError(
		"Could not read and validate Sonny configuration.",
		{ cause: error },
	);
}
