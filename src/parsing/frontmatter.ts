import matter from "gray-matter";

export type ParsedFrontmatter = {
	frontmatter: unknown;
	body: string;
};

export class FrontmatterParseError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "FrontmatterParseError";
	}
}

export function parseFrontmatter(fileContent: string): ParsedFrontmatter {
	try {
		const { data, content } = matter(fileContent);

		return {
			frontmatter: data,
			body: content.trim(),
		};
	} catch (error) {
		throw new FrontmatterParseError("Failed to parse frontmatter", {
			cause: error,
		});
	}
}
