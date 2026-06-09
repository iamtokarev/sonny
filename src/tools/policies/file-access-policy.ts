import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, basename as pathBasename, resolve, sep } from "node:path";

export type FileAccessDecision =
	| { allowed: true; path: string }
	| { allowed: false; path: string; reason: string };

const blockedEnvFiles = new Set([
	".env",
	".env.local",
	".env.development",
	".env.production",
	".env.test",
	".env.staging",
	".envrc",
]);

const blockedDevicePaths = new Set([
	"/dev/zero",
	"/dev/random",
	"/dev/urandom",
	"/dev/full",
	"/dev/stdin",
	"/dev/stdout",
	"/dev/stderr",
	"/dev/tty",
	"/dev/console",
]);

function expandHome(path: string): string {
	if (path === "~") {
		return homedir();
	}

	if (path.startsWith("~/")) {
		return resolve(homedir(), path.slice(2));
	}

	return path;
}

function resolveInputPath(path: string): string {
	const expandedPath = expandHome(path);
	const resolvedPath = isAbsolute(expandedPath)
		? resolve(expandedPath)
		: resolve(process.cwd(), expandedPath);

	if (!existsSync(resolvedPath)) {
		return resolvedPath;
	}

	try {
		return realpathSync.native(resolvedPath);
	} catch {
		return resolvedPath;
	}
}

function denied(path: string, reason: string): FileAccessDecision {
	return {
		allowed: false,
		path,
		reason,
	};
}

function allowed(path: string): FileAccessDecision {
	return {
		allowed: true,
		path,
	};
}

function isBlockedEnvFile(path: string): boolean {
	return blockedEnvFiles.has(pathBasename(path));
}

function isBlockedExactPath(path: string): boolean {
	const home = homedir();

	const blockedExactPaths = new Set([
		resolve(home, ".netrc"),
		resolve(home, ".npmrc"),
		resolve(home, ".pypirc"),
		resolve(home, ".git-credentials"),
		"/etc/passwd",
		"/etc/shadow",
	]);

	return blockedExactPaths.has(path);
}

function isInsideOrEqual(path: string, directory: string): boolean {
	return path === directory || path.startsWith(`${directory}${sep}`);
}

function isBlockedCredentialDirectory(path: string): boolean {
	const home = homedir();

	const blockedCredentialDirectories = [
		resolve(home, ".ssh"),
		resolve(home, ".aws"),
		resolve(home, ".gnupg"),
		resolve(home, ".kube"),
		resolve(home, ".docker"),
		resolve(home, ".azure"),
		resolve(home, ".config", "gh"),
		resolve(home, ".config", "gcloud"),
	];

	return blockedCredentialDirectories.some((directory) =>
		isInsideOrEqual(path, directory),
	);
}

function isBlockedDevicePath(path: string): boolean {
	return blockedDevicePaths.has(path);
}

export function checkFileReadAccess(path: string): FileAccessDecision {
	const resolvedPath = resolveInputPath(path);

	if (isBlockedEnvFile(resolvedPath)) {
		return denied(
			resolvedPath,
			"Access denied: refusing to read environment files",
		);
	}

	if (isBlockedExactPath(resolvedPath)) {
		return denied(
			resolvedPath,
			"Access denied: refusing to read sensitive files",
		);
	}

	if (isBlockedCredentialDirectory(resolvedPath)) {
		return denied(
			resolvedPath,
			"Access denied: refusing to read credential directories",
		);
	}

	if (isBlockedDevicePath(resolvedPath)) {
		return denied(resolvedPath, "Access denied: refusing to read device paths");
	}

	return allowed(resolvedPath);
}
