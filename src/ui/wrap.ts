/**
 * Bands and the composer tint are background fills, so their rows have to be
 * padded to an exact width. That means we wrap text ourselves instead of
 * leaving it to the terminal.
 */
export function wrapText(text: string, width: number): string[] {
	if (width <= 0) {
		return [text];
	}

	const lines: string[] = [];

	for (const paragraph of text.split("\n")) {
		if (paragraph.length <= width) {
			lines.push(paragraph);
			continue;
		}

		let current = "";

		for (const word of paragraph.split(" ")) {
			if (current.length === 0) {
				current = word;
				continue;
			}

			if (current.length + 1 + word.length <= width) {
				current = `${current} ${word}`;
				continue;
			}

			lines.push(current);
			current = word;
		}

		if (current.length > 0) {
			lines.push(current);
		}

		// A single word longer than the terminal still has to be broken.
		const overflowing = lines.filter((line) => line.length > width);

		if (overflowing.length > 0) {
			const broken: string[] = [];

			for (const line of lines) {
				if (line.length <= width) {
					broken.push(line);
					continue;
				}

				for (let index = 0; index < line.length; index += width) {
					broken.push(line.slice(index, index + width));
				}
			}

			lines.length = 0;
			lines.push(...broken);
		}
	}

	return lines.length === 0 ? [""] : lines;
}

export function padTo(text: string, width: number): string {
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}
