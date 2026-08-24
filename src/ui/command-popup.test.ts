import { describe, expect, test } from "bun:test";
import { createDefaultCommandRegistry } from "../commands/create-command-registry";
import {
	filterCommands,
	findClosestCommand,
	toCommandOptions,
} from "./command-popup";

const options = toCommandOptions(createDefaultCommandRegistry().list());

describe("toCommandOptions", () => {
	test("takes every registered command, so a new one appears for free", () => {
		expect(options.map((option) => option.name).sort()).toEqual([
			"compact",
			"context",
			"help",
			"reload",
			"session",
			"skills",
		]);
	});
});

describe("filterCommands", () => {
	test("shows everything for a bare slash", () => {
		expect(filterCommands(options, "/")).toHaveLength(options.length);
	});

	test("narrows by prefix", () => {
		expect(filterCommands(options, "/co").map((option) => option.name)).toEqual(
			["context", "compact"],
		);
	});

	test("returns nothing when there is no match", () => {
		expect(filterCommands(options, "/zzz")).toEqual([]);
	});
});

describe("findClosestCommand", () => {
	test("suggests the nearest command for a typo", () => {
		expect(findClosestCommand(options, "/contxt")?.name).toBe("context");
	});

	test("stays quiet when nothing is close", () => {
		expect(findClosestCommand(options, "/zzz")).toBe(null);
	});
});
