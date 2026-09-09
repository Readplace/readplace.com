import type { GmailAccountEmail } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "./gmail-filters";

export type FindGmailAccountEmail = (input: {
	userId: UserId;
}) => Promise<GmailApiResult<GmailAccountEmail>>;
