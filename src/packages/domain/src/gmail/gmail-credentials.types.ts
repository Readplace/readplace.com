import type { UserId } from "../user";

export interface GmailCredentialsStore {
	saveCredentials: (input: {
		userId: UserId;
		refreshToken: string;
		grantedScope: string;
	}) => Promise<void>;
	findRefreshTokenByUserId: (userId: UserId) => Promise<string | undefined>;
	deleteCredentials: (userId: UserId) => Promise<void>;
}
