export type PasswordResetToken = string & { readonly __brand: "PasswordResetToken" };

export type CreatePasswordResetToken = (args: { email: string }) => Promise<PasswordResetToken>;

export type VerifyPasswordResetToken = (token: PasswordResetToken) => Promise<
	| { ok: true; email: string }
	| { ok: false; reason: "invalid-token" }
>;
