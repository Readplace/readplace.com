import { createHmac, randomUUID } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ObserveSession } from "@packages/provider-contracts/auth";

export function initObserveSession(deps: {
	salt: string;
	now: () => Date;
	logger: HutchLogger.Typed<Record<string, unknown>>;
	context: () => Record<string, unknown>;
}): ObserveSession {
	const reference = (kind: string, value: string) => createHmac("sha256", deps.salt)
		.update(`auth-diagnostics:${kind}:`).update(value).digest("hex");
	return ({ sessionId, userId, expiresAt, previousExpiresAt, ...event }) => {
		try {
			deps.logger.info({
				...deps.context(), ...event, stream: "auth-diagnostics", schema_version: 1, source: "server",
				event_id: randomUUID(), occurred_at: deps.now().toISOString(), recorded_at: deps.now().toISOString(),
				session_ref: reference("session", sessionId),
				...(userId === undefined ? {} : { subject_ref: reference("subject", userId) }),
				...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
				...(previousExpiresAt === undefined ? {} : { previous_expires_at: previousExpiresAt }),
			});
		} catch {
			try {
				deps.logger.error({ stream: "auth-diagnostics", event: "journal_health", source: "server", reason: "journal_unavailable" });
			} catch {}
		}
	};
}
