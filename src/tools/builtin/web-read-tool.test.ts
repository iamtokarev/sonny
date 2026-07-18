import { describe, expect, mock, test } from "bun:test";
import type { WebReadResult } from "../../web";
import { createWebReadTool } from "./web-read-tool";

const webReadResult: WebReadResult = {
	url: "https://example.com/article",
	title: "Example article",
	content: "# Example\n\nArticle content.",
};

function createReadMock(result: WebReadResult = webReadResult) {
	return mock(async (_url: string): Promise<WebReadResult> => result);
}

describe("createWebReadTool", () => {
	test("reads a normalized URL and returns the result as JSON", async () => {
		const read = createReadMock();
		const tool = createWebReadTool({ read });

		const result = await tool.execute({
			url: "  https://example.com/article  ",
		});

		expect(read).toHaveBeenCalledWith("https://example.com/article");
		expect(result).toEqual({
			ok: true,
			content: JSON.stringify(webReadResult, null, 2),
		});
	});

	test("normalizes a URL without a path", async () => {
		const read = createReadMock();
		const tool = createWebReadTool({ read });

		await tool.execute({ url: "https://example.com" });

		expect(read).toHaveBeenCalledWith("https://example.com/");
	});

	test("rejects missing, malformed, and unsupported URLs", async () => {
		const read = createReadMock();
		const tool = createWebReadTool({ read });
		const invalidParameters = [
			undefined,
			{},
			{ url: 42 },
			{ url: "   " },
			{ url: "not a URL" },
			{ url: "ftp://example.com/file" },
		];

		for (const parameters of invalidParameters) {
			const result = await tool.execute(parameters);

			expect(result).toEqual({
				ok: false,
				error: "Invalid parameters: url must be a valid HTTP or HTTPS URL",
			});
		}

		expect(read).not.toHaveBeenCalled();
	});

	test("converts provider errors into a failed tool result", async () => {
		const read = mock(async (_url: string): Promise<WebReadResult> => {
			throw new Error("extraction unavailable");
		});
		const tool = createWebReadTool({ read });

		const result = await tool.execute({ url: "https://example.com/article" });

		expect(result).toEqual({
			ok: false,
			error: "Web read failed: extraction unavailable",
		});
	});
});
