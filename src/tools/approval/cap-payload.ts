function collectStringLengths(value: unknown, lengths: number[]): void {
	if (typeof value === "string") {
		lengths.push(value.length);
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectStringLengths(item, lengths);
		}
	} else if (typeof value === "object" && value !== null) {
		for (const item of Object.values(value)) {
			collectStringLengths(item, lengths);
		}
	}
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

function capString(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}

	const headLength = Math.ceil(limit / 2);
	const tailLength = limit - headLength;
	const omitted = text.length - limit;

	return (
		text.slice(0, headLength) +
		`[${omitted} characters omitted]` +
		text.slice(text.length - tailLength)
	);
}

function mapStrings(value: unknown, map: (text: string) => string): unknown {
	if (typeof value === "string") {
		return map(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => mapStrings(item, map));
	}

	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]),
		);
	}

	return value;
}

/**
 * Shortens the string values in `value` so that together they keep at most
 * `maxChars` characters. Each shortened string keeps its head and tail around
 * an explicit "[N characters omitted]" marker, so the judge still sees how a
 * file write or command starts and ends.
 */
export function capStringPayload(value: unknown, maxChars: number): unknown {
	const lengths: number[] = [];
	collectStringLengths(value, lengths);
	const limit = perStringLimit(lengths, maxChars);

	if (limit === null) {
		return value;
	}

	return mapStrings(value, (text) => capString(text, limit));
}
