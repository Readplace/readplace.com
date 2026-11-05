import type { CookieOptions } from "express";
import type { z } from "zod";
import { baseCookieOptions } from "./cookie-options";

export type CookieDefinition<Value extends string> = {
	readonly name: string;
	readonly options: (secure: boolean) => CookieOptions;
	readonly set: (input: {
		res: { cookie: (name: string, value: string, options: CookieOptions) => void };
		value: Value;
		secure: boolean;
	}) => void;
	readonly read: (req: { cookies?: Record<string, unknown> }) => Value | undefined;
	readonly consume: (input: {
		req: { cookies?: Record<string, unknown> };
		res: { clearCookie: (name: string, options: { path: string }) => void };
	}) => Value | undefined;
};

export function defineCookie<Value extends string>(definition: {
	name: string;
	maxAgeMs: number | "browser-session";
	sameSite: "lax" | "none";
	httpOnly: boolean;
	schema: z.ZodType<Value>;
}): CookieDefinition<Value> {
	const { name, maxAgeMs, sameSite, httpOnly, schema } = definition;
	const maxAge = maxAgeMs === "browser-session" ? {} : { maxAge: maxAgeMs };
	const options = (secure: boolean): CookieOptions => ({
		...baseCookieOptions(secure),
		sameSite,
		httpOnly,
		...maxAge,
	});
	const read = (req: { cookies?: Record<string, unknown> }): Value | undefined => {
		const result = schema.safeParse(req.cookies?.[name]);
		return result.success ? result.data : undefined;
	};
	return {
		name,
		options,
		set: (input) => {
			input.res.cookie(name, input.value, options(input.secure));
		},
		read,
		consume: (input) => {
			const value = read(input.req);
			input.res.clearCookie(name, { path: "/" });
			return value;
		},
	};
}
