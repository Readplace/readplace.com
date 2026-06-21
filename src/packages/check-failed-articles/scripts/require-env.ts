import assert from "node:assert";

export function requireEnv<T extends string = string>(name: string): T {
	const value = process.env[name];
	assert.ok(value !== undefined, `Environment variable ${name} is required but not set`);
	return value as T;
}

export function getEnv(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value === "" ? undefined : value;
}
