import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import { initObserveSession } from "@packages/web-session";
import { initAuthDiagnosticPermits } from "./permit";

export interface AuthDiagnosticContext {
	request_id: string;
	context_id: string;
	client: "web" | "chrome" | "firefox" | "ios" | "android" | "external";
	surface: "website" | "background" | "app" | "share" | "external";
	operation_id?: string;
	attempt_id?: string;
	client_version?: string;
	installation_ref?: string;
	grant_id?: string;
	subject_ref?: string;
	auth_refusal_reason?: "expired" | "revoked";
	reason?: "login" | "sliding_visit" | "oauth_bridge" | "web_logout" | "native_logout" | "oauth_account_switch" | "password_reset" | "account_deleted";
}

export const authDiagnosticContext = new AsyncLocalStorage<AuthDiagnosticContext>();

export function initAuthDiagnosticRecorder(deps: { salt: string; now: () => Date; logger: HutchLogger.Typed<Record<string, unknown>> }) {
	const permits = initAuthDiagnosticPermits(deps);
	const write = (event: Record<string, unknown>) => deps.logger.info({
		...event, stream: "auth-diagnostics", schema_version: 1, recorded_at: deps.now().toISOString(),
	});
	const observe = (event: Record<string, unknown>) => {
		try {
			write({
				...authDiagnosticContext.getStore(), event_id: randomUUID(), source: "server",
				occurred_at: deps.now().toISOString(), ...event,
			});
		} catch {
			try {
				deps.logger.error({ stream: "auth-diagnostics", event: "journal_health", source: "server", reason: "journal_unavailable" });
			} catch {}
		}
	};
	const observeSession = initObserveSession({ ...deps, context: () => ({ ...authDiagnosticContext.getStore() }) });
	return { write, observe, observeSession, permits };
}
