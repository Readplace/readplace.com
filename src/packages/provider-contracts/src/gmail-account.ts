import type { GmailAccountEmail } from "@packages/domain/gmail";
import type { GmailApiResult } from "./gmail-filters";

export type FindGmailAccountEmail = (input: {
	accessToken: string;
}) => Promise<GmailApiResult<GmailAccountEmail>>;

export type ListConnectedGmailAccounts = (input: { pageToken?: string }) => Promise<{ userIds: import("@packages/domain/user").UserId[]; nextPageToken: string | undefined }>;
