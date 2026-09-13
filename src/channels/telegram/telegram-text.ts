function findBoundary(
	characters: readonly string[],
	length: number,
	boundary: readonly string[],
): number | null {
	for (let index = length - boundary.length; index >= 0; index -= 1) {
		if (
			boundary.every(
				(character, offset) => characters[index + offset] === character,
			)
		) {
			return index + boundary.length;
		}
	}

	return null;
}

function findWhitespaceBoundary(
	characters: readonly string[],
	length: number,
): number | null {
	for (let index = length - 1; index >= 0; index -= 1) {
		if (/\s/u.test(characters[index] ?? "")) {
			return index + 1;
		}
	}

	return null;
}

export function splitTelegramText(text: string, limit = 4_000): string[] {
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw new Error("Telegram text limit must be a positive integer.");
	}

	const characters = Array.from(text);

	if (characters.length === 0) {
		return [];
	}

	const chunks: string[] = [];
	let remaining = characters;

	while (remaining.length > limit) {
		const splitAt =
			findBoundary(remaining, limit, ["\n", "\n"]) ??
			findBoundary(remaining, limit, ["\n"]) ??
			findWhitespaceBoundary(remaining, limit) ??
			limit;

		chunks.push(remaining.slice(0, splitAt).join(""));
		remaining = remaining.slice(splitAt);
	}

	if (remaining.length > 0) {
		chunks.push(remaining.join(""));
	}

	return chunks;
}
