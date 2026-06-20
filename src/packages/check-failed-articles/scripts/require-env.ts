import assert from "node:assert/strict";

export function requireEnv(name: string): string {
	const value = process.env[name];
	assert(value, `${name} env var is required`);
	return value;
}

export function getEnv(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value === "" ? undefined : value;
}
