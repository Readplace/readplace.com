import { type UserId, UserIdSchema } from "../user";

const EMAIL_ISSUE_URL = /^email:\/\/inbox\/([^/?#]+)\/([^/?#]+)$/;

interface EmailIssueRef {
	userId: UserId;
	receivedAtMessageId: string;
}

export function emailIssueArticleUrl(ref: EmailIssueRef): string {
	return `email://inbox/${encodeURIComponent(ref.userId)}/${encodeURIComponent(ref.receivedAtMessageId)}`;
}

export function parseEmailIssueArticleUrl(url: string): EmailIssueRef | undefined {
	const match = EMAIL_ISSUE_URL.exec(url);
	if (match === null) return undefined;
	const [, encodedUserId, encodedReceivedAtMessageId] = match;
	return {
		userId: UserIdSchema.parse(decodeURIComponent(encodedUserId)),
		receivedAtMessageId: decodeURIComponent(encodedReceivedAtMessageId),
	};
}
