export type WebReadResult = {
	url: string;
	title: string;
	content: string;
};

export interface WebReadProvider {
	read(url: string): Promise<WebReadResult>;
}
