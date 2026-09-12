import type { GmailAccountEmail } from "@packages/domain/gmail";
import type { GmailApiResult } from "./gmail-filters";

export type FindGmailAccountEmail = (input: {
	accessToken: string;
}) => Promise<GmailApiResult<GmailAccountEmail>>;
