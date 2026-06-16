import assert from "node:assert";

export const requireEnv = (name: string): string => {
	const value = process.env[name];
	assert.ok(value !== undefined, `Environment variable ${name} is required but not set`);
	return value;
};

export function getEnv(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value === "" ? undefined : value;
}
