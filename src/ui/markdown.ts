/**
 * Enough markdown, not all of it.
 *
 * Six constructs cover essentially everything a coding assistant emits.
 * Anything else falls through as plain text rather than being half-rendered.
 */

export type MarkdownSpan = {
	text: string;
	/** Bold and inline code both render bright. */
	emphasis: boolean;
};

export type MarkdownLine =
	| { kind: "blank" }
	| { kind: "heading"; text: string }
	| { kind: "code"; text: string }
	| { kind: "bullet"; spans: MarkdownSpan[] }
	| { kind: "text"; spans: MarkdownSpan[] };

const fencePattern = /^\s*```/;
const headingPattern = /^(#{1,6})\s+(.*)$/;
const bulletPattern = /^\s*([-*+])\s+(.*)$/;
const orderedPattern = /^\s*(\d+)[.)]\s+(.*)$/;
const emphasisPattern = /(\*\*[^*]+\*\*|`[^`]+`|__[^_]+__)/g;

function stripMarkers(token: string): string {
	if (token.startsWith("**") && token.endsWith("**")) {
		return token.slice(2, -2);
	}

	if (token.startsWith("__") && token.endsWith("__")) {
		return token.slice(2, -2);
	}

	if (token.startsWith("`") && token.endsWith("`")) {
		return token.slice(1, -1);
	}

	return token;
}

export function parseSpans(text: string): MarkdownSpan[] {
	const spans: MarkdownSpan[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(emphasisPattern)) {
		const index = match.index ?? 0;

		if (index > lastIndex) {
			spans.push({ text: text.slice(lastIndex, index), emphasis: false });
		}

		spans.push({ text: stripMarkers(match[0]), emphasis: true });
		lastIndex = index + match[0].length;
	}

	if (lastIndex < text.length) {
		spans.push({ text: text.slice(lastIndex), emphasis: false });
	}

	return spans.length === 0 ? [{ text, emphasis: false }] : spans;
}

export function parseMarkdown(content: string): MarkdownLine[] {
	const lines: MarkdownLine[] = [];
	let insideFence = false;

	for (const raw of content.split("\n")) {
		if (fencePattern.test(raw)) {
			insideFence = !insideFence;
			continue;
		}

		if (insideFence) {
			lines.push({ kind: "code", text: raw });
			continue;
		}

		if (raw.trim().length === 0) {
			lines.push({ kind: "blank" });
			continue;
		}

		const heading = headingPattern.exec(raw);

		if (heading?.[2] !== undefined) {
			lines.push({ kind: "heading", text: heading[2].trim() });
			continue;
		}

		const bullet = bulletPattern.exec(raw);

		if (bullet?.[2] !== undefined) {
			lines.push({ kind: "bullet", spans: parseSpans(bullet[2]) });
			continue;
		}

		const ordered = orderedPattern.exec(raw);

		if (ordered?.[1] !== undefined && ordered[2] !== undefined) {
			lines.push({
				kind: "bullet",
				spans: [
					{ text: `${ordered[1]}. `, emphasis: false },
					...parseSpans(ordered[2]),
				],
			});
			continue;
		}

		lines.push({ kind: "text", spans: parseSpans(raw) });
	}

	// A trailing blank line would add a gap the transcript already provides.
	while (lines.at(-1)?.kind === "blank") {
		lines.pop();
	}

	return lines;
}
