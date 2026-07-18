import { describe, expect, mock, test } from "bun:test";
import type {
	WebSearchRequest,
	WebSearchResult,
} from "../../web/web-search-provider";
import { createWebSearchTool } from "./web-search-tool";

const searchResults: WebSearchResult[] = [
	{
		title: "TypeScript",
		url: "https://www.typescriptlang.org/",
		snippet: "TypeScript is JavaScript with syntax for types.",
	},
];

function createSearchMock(results: WebSearchResult[] = searchResults) {
	return mock(
		async (_request: WebSearchRequest): Promise<WebSearchResult[]> => results,
	);
}

describe("createWebSearchTool", () => {
	test("searches with normalized parameters and returns JSON results", async () => {
		const search = createSearchMock();
		const tool = createWebSearchTool({ search });

		const result = await tool.execute({
			query: "  typescript  ",
			maxResults: 3,
		});

		expect(search).toHaveBeenCalledWith({
			query: "typescript",
			maxResults: 3,
		});
		expect(result).toEqual({
			ok: true,
			content: JSON.stringify(searchResults, null, 2),
		});
	});

	test("defaults maxResults to five", async () => {
		const search = createSearchMock();
		const tool = createWebSearchTool({ search });

		await tool.execute({ query: "typescript" });

		expect(search).toHaveBeenCalledWith({
			query: "typescript",
			maxResults: 5,
		});
	});

	test("rejects missing, non-string, and blank queries", async () => {
		const search = createSearchMock();
		const tool = createWebSearchTool({ search });
		const invalidParameters = [undefined, {}, { query: 42 }, { query: "   " }];

		for (const parameters of invalidParameters) {
			const result = await tool.execute(parameters);

			expect(result).toEqual({
				ok: false,
				error:
					"Invalid parameters: query is required and maxResults must be an integer between 1 and 10",
			});
		}

		expect(search).not.toHaveBeenCalled();
	});

	test("rejects invalid maxResults values", async () => {
		const search = createSearchMock();
		const tool = createWebSearchTool({ search });
		const invalidValues = [0, 11, 1.5, "5"];

		for (const maxResults of invalidValues) {
			const result = await tool.execute({ query: "typescript", maxResults });

			expect(result).toEqual({
				ok: false,
				error:
					"Invalid parameters: query is required and maxResults must be an integer between 1 and 10",
			});
		}

		expect(search).not.toHaveBeenCalled();
	});

	test("returns an empty JSON array when no results are found", async () => {
		const search = createSearchMock([]);
		const tool = createWebSearchTool({ search });

		const result = await tool.execute({ query: "missing" });

		expect(result).toEqual({
			ok: true,
			content: "[]",
		});
	});

	test("converts provider errors into a failed tool result", async () => {
		const search = mock(
			async (_request: WebSearchRequest): Promise<WebSearchResult[]> => {
				throw new Error("service unavailable");
			},
		);
		const tool = createWebSearchTool({ search });

		const result = await tool.execute({ query: "typescript" });

		expect(result).toEqual({
			ok: false,
			error: "Web search failed: service unavailable",
		});
	});
});
