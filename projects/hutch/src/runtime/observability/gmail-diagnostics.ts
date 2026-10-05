import type { GmailHistoryImportMessageOutcome } from "@packages/domain/gmail";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GmailHttpAttempt } from "@packages/provider-contracts/gmail-history";
import type { GmailHistoryImportObservation } from "../domain/gmail/gmail-history-import-observation.types";

export const GMAIL_DIAGNOSTIC_VERSION = 1;

type GmailDiagnosticLevel = "INFO" | "ERROR";

export interface GmailOAuthCorrelation {
	route: "connect" | "callback";
	traceId: string;
	requestId: string | undefined;
	userId: string | undefined;
}

export interface GmailOAuthStateInspection {
	present: boolean;
	fingerprint: string | undefined;
	signatureValid: boolean | undefined;
	payload: "valid" | "malformed-json" | "schema-rejected" | undefined;
	createdAtMs: number | undefined;
	ageMs: number | undefined;
	intentKind: "connect" | "import" | undefined;
}

export type GmailOAuthCallbackDecision =
	| "provider-error"
	| "malformed-query"
	| "missing-cookie"
	| "invalid-signature"
	| "invalid-payload"
	| "state-mismatch"
	| "expired"
	| "accepted";

export interface GmailImportRecordCorrelation {
	handler: "history-import" | "history-import-page-dlq" | "history-import-outcomes" | "history-import-outcome-dlq";
	invocationId: string;
	sqsMessageId: string;
	receiveCount: number;
	sourceQueue: string;
	deadLetterSourceQueue: string | undefined;
	envelopeKind: "start" | "page" | "progress" | "outcome" | undefined;
	userId: string | undefined;
	jobId: string | undefined;
	generation: string | undefined;
	page: number | undefined;
}

export type GmailImportRecordStep =
	| Exclude<GmailHistoryImportObservation, { kind: "http-attempt" }>
	| { kind: "dead-letter-without-generation" }
	| { kind: "outcome-recorded"; result: "recorded" | "duplicate" | "stale"; outcome: GmailHistoryImportMessageOutcome };

export type GmailDiagnosticEvent =
	| (GmailOAuthCorrelation & {
		event: "gmail.oauth.request.received";
		level: "INFO";
		method: string;
		hxRequest: boolean;
	})
	| (GmailOAuthCorrelation & {
		event: "gmail.oauth.state.issued";
		level: "INFO";
		issuedStateFingerprint: string;
		previousCookie: GmailOAuthStateInspection;
		intentKind: "connect" | "import";
	})
	| (GmailOAuthCorrelation & {
		event: "gmail.oauth.callback.inspected";
		level: "INFO";
		providerError: string | undefined;
		codePresent: boolean;
		queryShape: "valid" | "malformed";
		queryState: GmailOAuthStateInspection;
		cookieState: GmailOAuthStateInspection;
		statesEqual: boolean;
		verifiedAgeMs: number | undefined;
		decisionAgeMs: number | undefined;
		ttlMs: number;
		decision: GmailOAuthCallbackDecision;
	})
	| (GmailOAuthCorrelation & {
		event: "gmail.oauth.request.completed";
		level: GmailDiagnosticLevel;
		completion: "finished" | "aborted";
		status: number;
		stage: string;
		failureReason: string | undefined;
		redirect: "google-authorize" | "integrations" | "gmail" | "login" | "other" | undefined;
		outcome: string | undefined;
		durationMs: number;
	})
	| (GmailImportRecordCorrelation & {
		event: "gmail.http.attempt";
		level: GmailDiagnosticLevel;
		sequence: number;
	} & GmailHttpAttempt)
	| (GmailImportRecordCorrelation & {
		event: "gmail.import.record.started";
		level: "INFO";
	})
	| (GmailImportRecordCorrelation & {
		event: "gmail.import.step";
		level: GmailDiagnosticLevel;
		sequence: number;
		step: GmailImportRecordStep;
	})
	| (GmailImportRecordCorrelation & {
		event: "gmail.import.publication";
		level: GmailDiagnosticLevel;
		sequence: number;
		target: string;
		outcome: "published" | "failed";
		errorName: string | undefined;
	})
	| (GmailImportRecordCorrelation & {
		event: "gmail.import.record.finished";
		level: GmailDiagnosticLevel;
		outcome: "acked" | "retry-requested";
		errorName: string | undefined;
		durationMs: number;
	});

export type RecordGmailDiagnostic = (event: GmailDiagnosticEvent) => void;

export function initRecordGmailDiagnostic(deps: { logger: HutchLogger; now: () => Date }): RecordGmailDiagnostic {
	return (event) => {
		try {
			const line = JSON.stringify({ version: GMAIL_DIAGNOSTIC_VERSION, timestamp: deps.now().toISOString(), ...event });
			if (event.level === "ERROR") deps.logger.error(line);
			else deps.logger.info(line);
		} catch {
			return;
		}
	};
}
