import type { GmailMessageOrigin } from "@packages/domain/gmail";
import type { InboxEmailLinkStore, InboxEmailStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { RecordDuplicateGmailOrigin } from "../gmail-import-completion/record-gmail-origin";
import { acceptedGmailRouting } from "./accepted-gmail-routing";

export type SettleExtractedEmail = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	rawEmailS3Key: string;
	deliversGmail: boolean;
	gmailOrigin: GmailMessageOrigin | undefined;
}) => Promise<boolean>;

export function initSettleExtractedEmail(deps: {
	getEmail: InboxEmailStore["getEmail"];
	findLinksMeta: InboxEmailLinkStore["findLinksMeta"];
	recordDuplicateGmailOrigin: RecordDuplicateGmailOrigin;
}): SettleExtractedEmail {
	return async ({ userId, receivedAtMessageId, rawEmailS3Key, deliversGmail, gmailOrigin }) => {
		const email = await deps.getEmail({ userId, receivedAtMessageId });
		if (email?.status !== "received" || email.rawEmailS3Key !== rawEmailS3Key) return false;
		if (deliversGmail && acceptedGmailRouting(email) === undefined) return false;
		const meta = await deps.findLinksMeta({ userId, receivedAtMessageId });
		if (meta?.extractionFailed !== false) return false;
		await deps.recordDuplicateGmailOrigin({ userId, receivedAtMessageId, origin: gmailOrigin });
		return true;
	};
}
