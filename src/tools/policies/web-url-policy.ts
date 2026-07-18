import { isIP } from "node:net";

export type WebUrlAccessDecision =
	| { allowed: true; url: string }
	| { allowed: false; url: string; reason: string };

const blockedMetadataHostnames = new Set([
	"instance-data",
	"instance-data.ec2.internal",
	"metadata.google",
	"metadata.google.internal",
	"metadata.azure.internal",
]);

function allowed(url: string): WebUrlAccessDecision {
	return { allowed: true, url };
}

function denied(url: string, reason: string): WebUrlAccessDecision {
	return { allowed: false, url, reason };
}

function isNonPublicIpv4(hostname: string): boolean {
	const octets = hostname.split(".").map(Number);

	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
		return true;
	}

	const [first = 0, second = 0, third = 0] = octets;

	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 0 && third === 0) ||
		(first === 192 && second === 0 && third === 2) ||
		(first === 192 && second === 168) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113) ||
		first >= 224
	);
}

function getMappedIpv4Address(address: string): string | null {
	if (!address.startsWith("::ffff:")) {
		return null;
	}

	const parts = address.slice("::ffff:".length).split(":");

	if (parts.length !== 2) {
		return null;
	}

	const high = Number.parseInt(parts[0] ?? "", 16);
	const low = Number.parseInt(parts[1] ?? "", 16);

	if (!Number.isInteger(high) || !Number.isInteger(low)) {
		return null;
	}

	return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function isNonPublicIpv6(address: string): boolean {
	const mappedIpv4 = getMappedIpv4Address(address);

	if (mappedIpv4 !== null) {
		return isNonPublicIpv4(mappedIpv4);
	}

	if (address === "::" || address === "::1") {
		return true;
	}

	const firstHextet = Number.parseInt(address.split(":")[0] ?? "", 16);

	return (
		(firstHextet & 0xfe00) === 0xfc00 ||
		(firstHextet & 0xffc0) === 0xfe80 ||
		(firstHextet & 0xffc0) === 0xfec0 ||
		(firstHextet & 0xff00) === 0xff00 ||
		address === "2001:db8::" ||
		address.startsWith("2001:db8:")
	);
}

function isBlockedHostname(hostname: string): boolean {
	const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");

	if (
		normalizedHostname === "localhost" ||
		normalizedHostname.endsWith(".localhost") ||
		normalizedHostname === "local" ||
		normalizedHostname.endsWith(".local") ||
		blockedMetadataHostnames.has(normalizedHostname)
	) {
		return true;
	}

	const address = normalizedHostname.replace(/^\[|\]$/g, "");
	const addressType = isIP(address);

	if (addressType === 4) {
		return isNonPublicIpv4(address);
	}

	if (addressType === 6) {
		return isNonPublicIpv6(address);
	}

	return false;
}

export function checkWebReadAccess(url: string): WebUrlAccessDecision {
	let parsedUrl: URL;

	try {
		parsedUrl = new URL(url.trim());
	} catch {
		return allowed(url);
	}

	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		return allowed(url);
	}

	const normalizedUrl = parsedUrl.toString();

	if (parsedUrl.username || parsedUrl.password) {
		return denied(
			normalizedUrl,
			"Access denied: refusing web requests with URL credentials",
		);
	}

	if (isBlockedHostname(parsedUrl.hostname)) {
		return denied(
			normalizedUrl,
			"Access denied: refusing web requests to local or non-public destinations",
		);
	}

	return allowed(normalizedUrl);
}
