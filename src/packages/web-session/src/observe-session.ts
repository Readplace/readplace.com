import { createHmac, randomUUID } from "node:crypto";
import type { Logger } from "@packages/logger";
import type { ObserveSession } from "@packages/provider-contracts/auth";

export function authDiagnosticReference(input: { salt: string; kind: "subject" | "session"; value: string }): string {
	return createHmac("sha256", input.salt).update(`auth-diagnostics:${input.kind}:`).update(input.value).digest("hex");
}

export function initObserveSession(deps: {
	salt: string;
	now: () => Date;
	logger: Logger.Typed<Record<string, unknown>>;
	context: () => Record<string, unknown>;
}): ObserveSession {
	const reference = (kind: "subject" | "session", value: string) => authDiagnosticReference({ salt: deps.salt, kind, value });
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
