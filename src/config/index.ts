import { join } from "node:path";

export const DEFAULT_CONFIG_PATH = join(import.meta.dirname, "config.yaml");
export const DEFAULT_ENV_PATH = join(process.cwd(), ".env");

export * from "./config-diff";
export * from "./config-error";
export * from "./config-store";
export * from "./load-config";
export * from "./parse-config";
export * from "./schemas";
