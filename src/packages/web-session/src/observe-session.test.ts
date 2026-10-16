import { initObserveSession } from "./observe-session";
import { UserIdSchema } from "@packages/domain/user";

describe("session audit", () => {
	it("retains session lifecycle linkage and cause without logging cookie or account identifiers", () => {
		const events: Record<string, unknown>[] = [];
		const capture = (event: Record<string, unknown>) => { events.push(event); };
		const observe = initObserveSession({ salt: "test", now: () => new Date(0),
			logger: { info: capture, error: capture, warn: capture, debug: capture }, context: () => ({ reason: "native_logout", grant_id: "grant-1" }),
		});
		observe({ event: "session_deleted", sessionId: "private-cookie", userId: UserIdSchema.parse("private-account"), expiresAt: 100, previousExpiresAt: 90 });
		observe({ event: "session_unavailable", sessionId: "private-cookie", reason: "row_missing" });
		expect(events[0]).toEqual({ event: "session_deleted", reason: "native_logout", grant_id: "grant-1", stream: "auth-diagnostics", schema_version: 1,
			source: "server", event_id: expect.any(String), occurred_at: new Date(0).toISOString(), recorded_at: new Date(0).toISOString(),
			session_ref: expect.stringMatching(/^[a-f0-9]{64}$/), subject_ref: expect.stringMatching(/^[a-f0-9]{64}$/), expires_at: 100, previous_expires_at: 90 });
		expect(events[1]).toEqual({ event: "session_unavailable", reason: "row_missing", grant_id: "grant-1", stream: "auth-diagnostics", schema_version: 1,
			source: "server", event_id: expect.any(String), occurred_at: new Date(0).toISOString(), recorded_at: new Date(0).toISOString(), session_ref: events[0].session_ref });
	});

	it("keeps session operations independent of logging failures", () => {
		const failures: Record<string, unknown>[] = [];
		const fail = () => { throw new Error("logger unavailable"); };
		const observe = initObserveSession({ salt: "test", now: () => new Date(0), context: () => ({}),
			logger: { info: fail, error: event => { failures.push(event); }, warn: fail, debug: fail } });
		observe({ event: "session_deleted", sessionId: "secret" });
		expect(failures).toEqual([{ stream: "auth-diagnostics", event: "journal_health", source: "server", reason: "journal_unavailable" }]);
		initObserveSession({ salt: "test", now: () => new Date(0), context: () => ({}), logger: { info: fail, error: fail, warn: fail, debug: fail } })({ event: "session_deleted", sessionId: "secret" });
	});
});
