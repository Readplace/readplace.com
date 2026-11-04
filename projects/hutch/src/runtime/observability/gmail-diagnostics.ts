import type { Logger } from "@packages/logger";
import type { RecordGmailDiagnostic } from "../domain/gmail/gmail-diagnostic.types";

export type { GmailDiagnosticEvent, GmailImportRecordCorrelation, GmailOAuthCallbackDecision, GmailOAuthCorrelation, GmailOAuthStateInspection, RecordGmailDiagnostic } from "../domain/gmail/gmail-diagnostic.types";

export const GMAIL_DIAGNOSTIC_VERSION = 1;

export function initRecordGmailDiagnostic(deps: { logger: Logger; now: () => Date }): RecordGmailDiagnostic {
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
