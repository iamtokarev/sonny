import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function dirExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
}

export async function findFiles(
	dir: string,
	match: (name: string) => boolean,
): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true, recursive: true });

	return entries
		.filter((e) => e.isFile() && match(e.name))
		.map((e) => join(e.parentPath, e.name));
}
