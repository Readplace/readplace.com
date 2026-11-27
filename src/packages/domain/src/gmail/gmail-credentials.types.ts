import type { UserId } from "../user";

export interface GmailCredentialsStore {
	saveCredentials: (input: {
		userId: UserId;
		refreshToken: string;
		grantedScope: string;
	}) => Promise<void>;
	findCredentialsByUserId: (userId: UserId) => Promise<{ refreshToken: string; grantedScope: string } | undefined>;
	deleteCredentials: (userId: UserId) => Promise<void>;
}
