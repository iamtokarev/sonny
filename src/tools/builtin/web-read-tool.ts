import type { WebReadProvider } from "../../web";
import type { Tool } from "../tool";

type WebReadParameters = {
	url: string;
};

function parseWebReadParameters(parameters: unknown): WebReadParameters | null {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		!("url" in parameters) ||
		typeof parameters.url !== "string" ||
		!parameters.url.trim()
	) {
		return null;
	}

	let url: URL;

	try {
		url = new URL(parameters.url.trim());
	} catch {
		return null;
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return null;
	}

	return { url: url.toString() };
}

export function createWebReadTool(provider: WebReadProvider): Tool {
	return {
		name: "webRead",
		description:
			"Read and extract the content of a web page from an HTTP or HTTPS URL.",
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					format: "uri",
					description: "HTTP or HTTPS URL of the web page to read.",
				},
			},
			required: ["url"],
			additionalProperties: false,
		},
		async execute(parameters) {
			const parsed = parseWebReadParameters(parameters);

			if (parsed === null) {
				return {
					ok: false,
					error: "Invalid parameters: url must be a valid HTTP or HTTPS URL",
				};
			}

			try {
				const result = await provider.read(parsed.url);

				return {
					ok: true,
					content: JSON.stringify(result, null, 2),
				};
			} catch (error) {
				return {
					ok: false,
					error: `Web read failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
		},
	};
}
