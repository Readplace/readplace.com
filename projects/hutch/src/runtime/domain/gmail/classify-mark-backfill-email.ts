import {
	GMAIL_DELIVERY_FAN_OUT,
	type GmailMarkBackfillRef,
	type GmailMessageOrigin,
	parseForwardableSender,
	resolveGmailDeliveryMode,
	sameGmailAccount,
} from "@packages/domain/gmail";
import { type EmailImportCandidate, type InboxEmailLinksMeta, isEmailSavedToAll, normalizeMessageId } from "@packages/domain/inbox";

export type MarkBackfillEmailClass =
	| { kind: "other" | "unverifiable" | "not-saved" | "unlocatable" }
	| { kind: "eligible"; origins: [GmailMessageOrigin, ...GmailMessageOrigin[]] };

function fromMappedSender(input: { email: EmailImportCandidate; job: GmailMarkBackfillRef }): boolean {
	const { email, job } = input;
	return email.status === "received" && email.gmailDestinationAddresses !== undefined && parseForwardableSender(email.senderEmail) === job.senderEmail;
}

export function needsLinksMeta(input: { email: EmailImportCandidate; job: GmailMarkBackfillRef }): boolean {
	return fromMappedSender(input) && input.email.selection === undefined && input.email.origins.length === 0;
}

function legacySaveEvidence(input: { email: EmailImportCandidate; meta: InboxEmailLinksMeta | undefined }): "saved" | "not-saved" | "unverifiable" {
	const { meta } = input;
	const fanOut = GMAIL_DELIVERY_FAN_OUT[resolveGmailDeliveryMode({ deliveryMode: input.email.gmailDeliveryMode })];
	if (meta === undefined) return "unverifiable";
	if ((fanOut.links && meta.savesHeld === undefined) || (fanOut.issue && meta.issueSave === undefined)) return "unverifiable";
	if (meta.extractionFailed || meta.truncated) return "not-saved";
	if ((fanOut.links && meta.savesHeld) || (fanOut.issue && meta.issueSave?.held)) return "not-saved";
	return "saved";
}

export function classifyMarkBackfillEmail(input: {
	email: EmailImportCandidate;
	meta: InboxEmailLinksMeta | undefined;
	job: GmailMarkBackfillRef;
}): MarkBackfillEmailClass {
	const { email, job } = input;
	if (!fromMappedSender(input)) return { kind: "other" };
	if (email.selection !== undefined) {
		if (!isEmailSavedToAll(email)) return { kind: "not-saved" };
	} else if (email.origins.length > 0) {
		return { kind: "not-saved" };
	} else {
		const evidence = legacySaveEvidence(input);
		if (evidence !== "saved") return { kind: evidence };
	}

	if (email.origins.length > 0) {
		const [first, ...rest] = email.origins.filter((origin) => sameGmailAccount(origin.accountEmail, job.accountEmail));
		return first === undefined ? { kind: "unlocatable" } : { kind: "eligible", origins: [first, ...rest] };
	}
	const rfcMessageId = normalizeMessageId(email.messageId);
	if (rfcMessageId === undefined) return { kind: "unlocatable" };
	return { kind: "eligible", origins: [{ kind: "forwarded", accountEmail: job.accountEmail, rfcMessageId, senderEmail: job.senderEmail }] };
}
