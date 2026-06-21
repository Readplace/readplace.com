import assert from 'node:assert';

// V8 coverage: Use const + arrow function to avoid function declaration coverage quirks - see https://github.com/jestjs/jest/issues/11188
export const requireEnv = <T extends string = string>(name: string): T => {
  const value = process.env[name];
  assert.ok(value !== undefined, `Environment variable ${name} is required but not set`);
  return value as T;
};

export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  // Single-line return for accurate V8 coverage - see https://github.com/jestjs/jest/issues/11188
  return (value === undefined || value === '') ? undefined : value;
}
