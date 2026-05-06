import type { Request } from "express";

export function collectUtmParams(query: Request["query"]): [string, string][] {
	return Object.entries(query).filter(
		(entry): entry is [string, string] =>
			/^utm_/i.test(entry[0]) && typeof entry[1] === "string",
	);
}
