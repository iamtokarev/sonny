export type WebSearchRequest = {
	query: string;
	maxResults: number;
};

export type WebSearchResult = {
	title: string;
	url: string;
	snippet: string;
};

export interface WebSearchProvider {
	search(request: WebSearchRequest): Promise<WebSearchResult[]>;
}
