import { describe, expect, test } from "bun:test";
import { checkWebReadAccess } from "./web-url-policy";

describe("checkWebReadAccess", () => {
	test("allows and normalizes public HTTP URLs", () => {
		expect(checkWebReadAccess("  https://example.com  ")).toEqual({
			allowed: true,
			url: "https://example.com/",
		});
		expect(checkWebReadAccess("http://8.8.8.8/docs")).toEqual({
			allowed: true,
			url: "http://8.8.8.8/docs",
		});
	});

	test("leaves malformed and unsupported URLs for tool validation", () => {
		expect(checkWebReadAccess("not a URL")).toEqual({
			allowed: true,
			url: "not a URL",
		});
		expect(checkWebReadAccess("ftp://example.com/file")).toEqual({
			allowed: true,
			url: "ftp://example.com/file",
		});
	});

	test("denies URLs containing credentials", () => {
		expect(checkWebReadAccess("https://user:secret@example.com")).toEqual({
			allowed: false,
			url: "https://user:secret@example.com/",
			reason: "Access denied: refusing web requests with URL credentials",
		});
	});

	test("denies localhost and metadata hostnames", () => {
		for (const url of [
			"http://localhost",
			"http://api.localhost",
			"http://service.local",
			"http://metadata.google.internal",
			"http://instance-data.ec2.internal",
		]) {
			const decision = checkWebReadAccess(url);

			expect(decision.allowed).toBe(false);
		}
	});

	test("denies non-public IPv4 destinations", () => {
		for (const url of [
			"http://0.0.0.0",
			"http://10.0.0.1",
			"http://100.64.0.1",
			"http://127.0.0.1",
			"http://169.254.169.254",
			"http://172.20.0.1",
			"http://192.168.1.1",
		]) {
			const decision = checkWebReadAccess(url);

			expect(decision.allowed).toBe(false);
		}
	});

	test("denies non-public IPv6 destinations", () => {
		for (const url of [
			"http://[::1]",
			"http://[fc00::1]",
			"http://[fe80::1]",
			"http://[::ffff:127.0.0.1]",
			"http://[2001:db8::1]",
		]) {
			const decision = checkWebReadAccess(url);

			expect(decision.allowed).toBe(false);
		}
	});
});
