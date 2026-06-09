import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { checkFileReadAccess } from "./file-access-policy";

describe("checkFileReadAccess", () => {
	test("allows a normal relative path", () => {
		const decision = checkFileReadAccess("README.md");

		expect(decision).toEqual({
			allowed: true,
			path: resolve(process.cwd(), "README.md"),
		});
	});

	test("returns the resolved absolute path", () => {
		const decision = checkFileReadAccess("./src/../README.md");

		expect(decision.path).toBe(resolve(process.cwd(), "README.md"));
	});

	test("blocks environment files", () => {
		const decision = checkFileReadAccess(".env");

		expect(decision.allowed).toBe(false);

		if (!decision.allowed) {
			expect(decision.reason).toBe(
				"Access denied: refusing to read environment files",
			);
		}
	});

	test("blocks local environment files", () => {
		const decision = checkFileReadAccess(".env.local");

		expect(decision.allowed).toBe(false);

		if (!decision.allowed) {
			expect(decision.reason).toBe(
				"Access denied: refusing to read environment files",
			);
		}
	});

	test("allows environment examples", () => {
		const decision = checkFileReadAccess(".env.example");

		expect(decision).toEqual({
			allowed: true,
			path: resolve(process.cwd(), ".env.example"),
		});
	});

	test("blocks SSH credential paths", () => {
		const decision = checkFileReadAccess("~/.ssh/id_ed25519");

		expect(decision.allowed).toBe(false);
		expect(decision.path).toBe(resolve(homedir(), ".ssh", "id_ed25519"));

		if (!decision.allowed) {
			expect(decision.reason).toBe(
				"Access denied: refusing to read credential directories",
			);
		}
	});

	test("blocks cloud credential paths", () => {
		const decision = checkFileReadAccess("~/.aws/credentials");

		expect(decision.allowed).toBe(false);
		expect(decision.path).toBe(resolve(homedir(), ".aws", "credentials"));

		if (!decision.allowed) {
			expect(decision.reason).toBe(
				"Access denied: refusing to read credential directories",
			);
		}
	});

	test("blocks device paths", () => {
		const decision = checkFileReadAccess("/dev/zero");

		expect(decision.allowed).toBe(false);

		if (!decision.allowed) {
			expect(decision.reason).toBe(
				"Access denied: refusing to read device paths",
			);
		}
	});
});
