/**
 * The only parameters that may be shortened before the decision model sees
 * them: bulk content whose head and tail say enough. Everything else — a
 * command, a working directory, a path, a URL, a query — is sent verbatim,
 * because a cut there could hide exactly the part that makes a call
 * dangerous.
 */
const contentFieldsByTool: ReadonlyMap<string, readonly string[]> = new Map([
	["writeFile", ["content"]],
	["editFile", ["oldText", "newText"]],
]);

function countStringChars(value: unknown): number {
	if (typeof value === "string") {
		return value.length;
	}

	if (typeof value === "object" && value !== null) {
		let total = 0;

		for (const item of Object.values(value)) {
			total += countStringChars(item);
		}

		return total;
	}

	return 0;
}

function omissionMarker(omitted: number): string {
	return `[${omitted} characters omitted]`;
}

/**
 * Keeps the head and tail of `text` around an omission marker so the result,
 * marker included, has at most `limit` characters. `null` when even the
 * marker alone would not fit.
 */
function capString(text: string, limit: number): string | null {
	if (text.length <= limit) {
		return text;
	}

	// The widest marker this cut can need: omitting fewer characters than
	// the whole text never takes more digits.
	const kept = limit - omissionMarker(text.length).length;

	if (kept < 0) {
		return null;
	}

	const headLength = Math.ceil(kept / 2);
	const tailLength = kept - headLength;

	return (
		text.slice(0, headLength) +
		omissionMarker(text.length - kept) +
		text.slice(text.length - tailLength)
	);
}

/**
 * The largest per-string length that keeps the total within `maxChars`:
 * short strings stay whole and the long ones share what is left evenly.
 * `null` when everything already fits.
 */
function perStringLimit(lengths: number[], maxChars: number): number | null {
	const ascending = [...lengths].sort((a, b) => a - b);
	let budget = maxChars;

	for (const [index, length] of ascending.entries()) {
		const share = Math.floor(budget / (ascending.length - index));

		if (length > share) {
			return share;
		}

		budget -= length;
	}

	return null;
}

export type CappedParameters = {
	readonly parameters: unknown;
	/** String characters in `parameters`, omission markers included. */
	readonly chars: number;
};

/**
 * Fits one call's parameters into `maxChars` string characters. Only the
 * tool's content fields are shortened, each keeping its head and tail around
 * an explicit "[N characters omitted]" marker that counts against the budget.
 * `null` when the parameters cannot fit without cutting anything else.
 */
export function capToolParameters(
	toolName: string,
	parameters: unknown,
	maxChars: number,
): CappedParameters | null {
	const total = countStringChars(parameters);

	if (total <= maxChars) {
		return { parameters, chars: total };
	}

	if (typeof parameters !== "object" || parameters === null) {
		return null;
	}

	const record = parameters as Record<string, unknown>;
	const contentFields = (contentFieldsByTool.get(toolName) ?? []).filter(
		(field) => typeof record[field] === "string",
	);
	const contents = contentFields.map((field) => record[field] as string);
	const contentChars = contents.reduce((sum, text) => sum + text.length, 0);
	const verbatimChars = total - contentChars;
	const limit = perStringLimit(
		contents.map((text) => text.length),
		maxChars - verbatimChars,
	);

	if (limit === null || limit < 0) {
		return null;
	}

	const capped: Record<string, unknown> = { ...record };
	let chars = verbatimChars;

	for (const field of contentFields) {
		const text = capString(record[field] as string, limit);

		if (text === null) {
			return null;
		}

		capped[field] = text;
		chars += text.length;
	}

	return { parameters: capped, chars };
}
