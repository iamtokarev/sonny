import type { WebSearchProvider, WebSearchRequest } from "../../web";
import type { Tool } from "../tool";

const defaultMaxResults = 5;
const maxAllowedResults = 10;

function parseWebSearchParameters(
	parameters: unknown,
): WebSearchRequest | null {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		!("query" in parameters) ||
		typeof parameters.query !== "string" ||
		!parameters.query.trim()
	) {
		return null;
	}

	const maxResults =
		"maxResults" in parameters ? parameters.maxResults : defaultMaxResults;

	if (
		typeof maxResults !== "number" ||
		!Number.isInteger(maxResults) ||
		maxResults < 1 ||
		maxResults > maxAllowedResults
	) {
		return null;
	}

	return {
		query: parameters.query.trim(),
		maxResults,
	};
}

export function createWebSearchTool(provider: WebSearchProvider): Tool {
	return {
		name: "webSearch",
		description:
			"Search the web and return relevant result titles, URLs, and snippets.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query.",
				},
				maxResults: {
					type: "integer",
					minimum: 1,
					maximum: maxAllowedResults,
					default: defaultMaxResults,
					description: "Maximum number of results to return.",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		async execute(parameters) {
			const parsed = parseWebSearchParameters(parameters);

			if (parsed === null) {
				return {
					ok: false,
					error:
						"Invalid parameters: query is required and maxResults must be an integer between 1 and 10",
				};
			}

			try {
				const results = await provider.search(parsed);

				return {
					ok: true,
					content: JSON.stringify(results, null, 2),
				};
			} catch (error) {
				return {
					ok: false,
					error: `Web search failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
		},
	};
}
