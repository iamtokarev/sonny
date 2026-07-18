import type { TavilyClient } from "@tavily/core";
import type { WebReadProvider, WebReadResult } from "./web-read-provider";
import type {
	WebSearchProvider,
	WebSearchRequest,
	WebSearchResult,
} from "./web-search-provider";

export class TavilyWebProvider implements WebSearchProvider, WebReadProvider {
	constructor(
		private readonly client: Pick<TavilyClient, "search" | "extract">,
	) {}

	async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
		const response = await this.client.search(request.query, {
			searchDepth: "basic",
			topic: "general",
			maxResults: request.maxResults,
			includeAnswer: false,
			includeRawContent: false,
			includeImages: false,
		});

		return response.results.map((result) => ({
			title: result.title,
			url: result.url,
			snippet: result.content,
		}));
	}

	async read(url: string): Promise<WebReadResult> {
		const response = await this.client.extract([url], {
			extractDepth: "basic",
			format: "markdown",
			includeImages: false,
			includeFavicon: false,
		});

		const result = response.results[0];

		if (!result) {
			const failure = response.failedResults[0];

			if (failure) {
				throw new Error(`Failed to extract "${url}": ${failure.error}`);
			}

			throw new Error(`No content returned for "${url}"`);
		}

		if (!result.rawContent.trim()) {
			throw new Error(`Empty content returned for "${url}"`);
		}

		return {
			url: result.url,
			title: result.title ?? result.url,
			content: result.rawContent,
		};
	}
}
