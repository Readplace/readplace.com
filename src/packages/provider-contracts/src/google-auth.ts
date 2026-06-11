import type { $brand } from "zod";

export type GoogleId = string & $brand<"GoogleId">;

export interface GoogleTokenResult {
	googleId: GoogleId;
	email: string;
	emailVerified: boolean;
}

export type ExchangeGoogleCode = (code: string) => Promise<GoogleTokenResult>;
