import { requireEnv } from "./require-env";

export type EnvNames = readonly string[];
export type EnvValues<N extends EnvNames> = { readonly [K in N[number]]: string };

export const readEnv = <const N extends EnvNames>(names: N): EnvValues<N> =>
	Object.fromEntries(names.map((name) => [name, requireEnv(name)])) as EnvValues<N>;
