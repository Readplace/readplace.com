import type { RequestHandler } from "express";
import { AuthDiagnosticBatch, AUTH_DIAGNOSTIC_LIMITS } from "@packages/domain/auth-diagnostics";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import type { AuthDiagnosticPermit } from "./permit";

export function initIngestAuthDiagnostics(deps: {
	verifyPermit: (value: string) => AuthDiagnosticPermit | undefined;
	consumeRateLimit: ConsumeRateLimit;
	record: (event: Record<string, unknown>) => void;
	now: () => Date;
}): RequestHandler {
	return async (req, res) => {
		res.set("Cache-Control", "no-store");
		const authorization = req.get("authorization");
		const permit = authorization?.startsWith("Bearer ") ? deps.verifyPermit(authorization.slice(7)) : undefined;
		if (!permit) {
			res.status(401).json({ error: "invalid_diagnostic_permit" });
			return;
		}
		const serialized = JSON.stringify(req.body);
		if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > AUTH_DIAGNOSTIC_LIMITS.batchBytes) {
			res.status(413).json({ error: "diagnostic_batch_too_large" });
			return;
		}
		const parsed = AuthDiagnosticBatch.safeParse(req.body);
		if (!parsed.success || parsed.data.events.some((event) => event.client !== permit.client)) {
			res.status(400).json({ error: "invalid_diagnostic_batch" });
			return;
		}
		const limit = await deps.consumeRateLimit({
			bucket: "auth-diagnostics", key: `${permit.subject_ref}:${permit.installation_ref}`,
			rule: { limit: 10, windowSeconds: 60 },
		});
		if (!limit.allowed) {
			res.status(429).set("Retry-After", String(limit.retryAfterSeconds)).json({ error: "diagnostics_rate_limited" });
			return;
		}
		const accepted = new Set<string>();
		for (const event of parsed.data.events) {
			if (accepted.has(event.event_id)) continue;
			deps.record({
				...event, schema_version: 1, source: "client", recorded_at: deps.now().toISOString(),
				subject_ref: permit.subject_ref, grant_id: permit.grant_id, installation_ref: permit.installation_ref,
			});
			accepted.add(event.event_id);
		}
		res.status(202).json({ accepted_event_ids: [...accepted] });
	};
}
