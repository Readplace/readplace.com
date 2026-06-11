import type { UserId } from "@packages/domain/user";

export type VerificationToken = string & { readonly __brand: "VerificationToken" };

export type CreateVerificationToken = (args: { userId: UserId; email: string }) => Promise<VerificationToken>;

export type VerifyEmailToken = (token: VerificationToken) => Promise<
	| { ok: true; userId: UserId; email: string }
	| { ok: false; reason: "invalid-token" }
>;
