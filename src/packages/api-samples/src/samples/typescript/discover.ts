import assert from "node:assert";
import { z } from "zod";

const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

const sirenAction = z.object({
	name: z.string(),
	href: z.string(),
	method: z.string(),
	type: z.string().optional(),
});
const sirenCollection = z.object({ actions: z.array(sirenAction) });
export type SirenCollection = z.infer<typeof sirenCollection>;

export function sirenHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}`, Accept: SIREN_MEDIA_TYPE };
}

export async function discover(params: {
	origin: string;
	token: string;
}): Promise<SirenCollection> {
	const headers = sirenHeaders(params.token);
	const entry = await fetch(new URL("/", params.origin), {
		headers,
		redirect: "manual",
	});
	assert.equal(entry.status, 200, `the entry point answered ${entry.status}`);
	return sirenCollection.parse(await entry.json());
}
