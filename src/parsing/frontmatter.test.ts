import { describe, expect, test } from "bun:test";
import { FrontmatterParseError, parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
	test("parses markdown frontmatter and body", () => {
		const parsed = parseFrontmatter(`---
name: Test Name
description: Test Description
---
Body
`);

		expect(parsed.frontmatter).toEqual({
			name: "Test Name",
			description: "Test Description",
		});
		expect(parsed.body).toBe("Body");
	});

	test("throws FrontmatterParseError for invalid frontmatter", () => {
		expect(() =>
			parseFrontmatter(`---
name: [broken
---
Body
`),
		).toThrow(FrontmatterParseError);
	});
});
