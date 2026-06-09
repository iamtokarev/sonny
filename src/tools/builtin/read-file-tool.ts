import { stat } from "node:fs/promises";
import { checkFileReadAccess } from "../policies/file-access-policy";
import type { Tool } from "../tool";

type ReadFileParameters = {
	path: string;
};

function parseReadFileParameters(
	parameters: unknown,
): ReadFileParameters | null {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		!("path" in parameters) ||
		typeof parameters.path !== "string"
	) {
		return null;
	}

	return {
		path: parameters.path,
	};
}

export const readFileTool: Tool = {
	name: "read_file",
	description: "Read the content of a text file",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Path to the file to read",
			},
		},
		required: ["path"],
		additionalProperties: false,
	},
	execute: async (parameters) => {
		const parsed = parseReadFileParameters(parameters);

		if (parsed === null) {
			return {
				ok: false,
				error: "Invalid parameters: path is required",
			};
		}

		const decision = checkFileReadAccess(parsed.path);

		if (!decision.allowed) {
			return {
				ok: false,
				error: decision.reason,
			};
		}

		const filePath = decision.path;

		let fileStat: Awaited<ReturnType<typeof stat>>;

		try {
			fileStat = await stat(filePath);
		} catch {
			return {
				ok: false,
				error: `File not found: ${filePath}`,
			};
		}

		if (fileStat.isDirectory()) {
			return {
				ok: false,
				error: `Path is a directory: ${filePath}`,
			};
		}

		const file = Bun.file(filePath);
		const content = await file.text();

		return {
			ok: true,
			content,
		};
	},
};
