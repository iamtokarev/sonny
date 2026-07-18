import { describe, expect, mock, test } from "bun:test";
import type {
	TavilyClient,
	TavilyExtractOptions,
	TavilyExtractResponse,
	TavilySearchOptions,
	TavilySearchResponse,
} from "@tavily/core";
import { TavilyWebProvider } from "./tavily-web-provider";

type TavilyWebClient = Pick<TavilyClient, "search" | "extract">;

function createSearchResponse(
	results: TavilySearchResponse["results"] = [],
): TavilySearchResponse {
	return {
		query: "typescript",
		responseTime: 0.1,
		images: [],
		results,
		requestId: "search-request",
	};
}

function createExtractResponse(
	overrides: Partial<TavilyExtractResponse> = {},
): TavilyExtractResponse {
	return {
		results: [],
		failedResults: [],
		responseTime: 0.1,
		requestId: "extract-request",
		...overrides,
	};
}

function createProvider(overrides: Partial<TavilyWebClient> = {}) {
	const search = mock(
		async (
			_query: string,
			_options?: TavilySearchOptions,
		): Promise<TavilySearchResponse> => createSearchResponse(),
	);
	const extract = mock(
		async (
			_urls: string[],
			_options?: TavilyExtractOptions,
		): Promise<TavilyExtractResponse> => createExtractResponse(),
	);
	const client: TavilyWebClient = {
		search,
		extract,
		...overrides,
	};

	return {
		provider: new TavilyWebProvider(client),
		search,
		extract,
	};
}

describe("TavilyWebProvider", () => {
	describe("search", () => {
		test("maps the request and normalizes search results", async () => {
			const search = mock(
				async (
					_query: string,
					_options?: TavilySearchOptions,
				): Promise<TavilySearchResponse> =>
					createSearchResponse([
						{
							title: "TypeScript",
							url: "https://www.typescriptlang.org/",
							content: "TypeScript is JavaScript with syntax for types.",
							score: 0.95,
							publishedDate: "",
						},
					]),
			);
			const { provider } = createProvider({ search });

			const result = await provider.search({
				query: "typescript",
				maxResults: 3,
			});

			expect(search).toHaveBeenCalledWith("typescript", {
				searchDepth: "basic",
				topic: "general",
				maxResults: 3,
				includeAnswer: false,
				includeRawContent: false,
				includeImages: false,
			});
			expect(result).toEqual([
				{
					title: "TypeScript",
					url: "https://www.typescriptlang.org/",
					snippet: "TypeScript is JavaScript with syntax for types.",
				},
			]);
		});

		test("returns an empty array when no results are found", async () => {
			const { provider } = createProvider();

			const result = await provider.search({
				query: "missing",
				maxResults: 5,
			});

			expect(result).toEqual([]);
		});

		test("propagates client errors", async () => {
			const search = mock(async (): Promise<TavilySearchResponse> => {
				throw new Error("search unavailable");
			});
			const { provider } = createProvider({ search });

			await expect(
				provider.search({ query: "typescript", maxResults: 5 }),
			).rejects.toThrow("search unavailable");
		});
	});

	describe("read", () => {
		test("extracts and normalizes page content", async () => {
			const extract = mock(
				async (
					_urls: string[],
					_options?: TavilyExtractOptions,
				): Promise<TavilyExtractResponse> =>
					createExtractResponse({
						results: [
							{
								url: "https://example.com/article",
								title: "Example article",
								rawContent: "# Example\n\nArticle content.",
							},
						],
					}),
			);
			const { provider } = createProvider({ extract });

			const result = await provider.read("https://example.com/article");

			expect(extract).toHaveBeenCalledWith(["https://example.com/article"], {
				extractDepth: "basic",
				format: "markdown",
				includeImages: false,
				includeFavicon: false,
			});
			expect(result).toEqual({
				url: "https://example.com/article",
				title: "Example article",
				content: "# Example\n\nArticle content.",
			});
		});

		test("uses the result URL when the title is missing", async () => {
			const extract = mock(
				async (): Promise<TavilyExtractResponse> =>
					createExtractResponse({
						results: [
							{
								url: "https://example.com/article",
								title: null,
								rawContent: "Article content.",
							},
						],
					}),
			);
			const { provider } = createProvider({ extract });

			const result = await provider.read("https://example.com/article");

			expect(result.title).toBe("https://example.com/article");
		});

		test("throws the extraction failure returned by Tavily", async () => {
			const extract = mock(
				async (): Promise<TavilyExtractResponse> =>
					createExtractResponse({
						failedResults: [
							{
								url: "https://example.com/private",
								error: "Access denied",
							},
						],
					}),
			);
			const { provider } = createProvider({ extract });

			await expect(
				provider.read("https://example.com/private"),
			).rejects.toThrow(
				'Failed to extract "https://example.com/private": Access denied',
			);
		});

		test("throws when Tavily returns neither a result nor a failure", async () => {
			const { provider } = createProvider();

			await expect(
				provider.read("https://example.com/article"),
			).rejects.toThrow(
				'No content returned for "https://example.com/article"',
			);
		});

		test("throws when extracted content is empty", async () => {
			const extract = mock(
				async (): Promise<TavilyExtractResponse> =>
					createExtractResponse({
						results: [
							{
								url: "https://example.com/empty",
								title: "Empty page",
								rawContent: "   ",
							},
						],
					}),
			);
			const { provider } = createProvider({ extract });

			await expect(provider.read("https://example.com/empty")).rejects.toThrow(
				'Empty content returned for "https://example.com/empty"',
			);
		});

		test("propagates client errors", async () => {
			const extract = mock(async (): Promise<TavilyExtractResponse> => {
				throw new Error("extract unavailable");
			});
			const { provider } = createProvider({ extract });

			await expect(
				provider.read("https://example.com/article"),
			).rejects.toThrow("extract unavailable");
		});
	});
});
