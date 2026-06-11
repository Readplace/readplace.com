export type GoogleId = string & { readonly __brand: "GoogleId" };

export interface GoogleTokenResult {
	googleId: GoogleId;
	email: string;
	emailVerified: boolean;
}

export type ExchangeGoogleCode = (code: string) => Promise<GoogleTokenResult>;
