import { createHash } from "node:crypto";
import { z } from "zod";
import { RefreshRefusal } from "./outcomes";

export function initIngestRefreshRefusal(record: (refusal: RefreshRefusal) => Promise<void>) {
	return async (input: { message: string; timestamp: number; source: string; id: string }) => {
		let value: unknown;
		try { value = JSON.parse(input.message); } catch { return; }
		const event = z.object({ event: z.string(), grant_type: z.string() }).safeParse(value);
		if (!event.success || event.data.event !== "oauth_token_refused" || event.data.grant_type !== "refresh_token") return;
		const fields = z.object({ status: z.number(), refresh_refusal: z.unknown().optional() }).parse(value);
		if (fields.refresh_refusal !== undefined) {
			await record(RefreshRefusal.parse(fields.refresh_refusal));
			return;
		}
		await record(RefreshRefusal.parse({ refusalId: createHash("sha256").update(`${input.source}\0${input.id}`).digest("hex"), occurredAt: input.timestamp, fingerprint: "unknown", status: fields.status, reason: "unknown" }));
	};
}
