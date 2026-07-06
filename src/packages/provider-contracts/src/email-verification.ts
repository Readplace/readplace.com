import { z } from "zod";
import type { UserId } from "@packages/domain/user";

export const VerificationTokenSchema = z.string().brand<"VerificationToken">();
export type VerificationToken = z.infer<typeof VerificationTokenSchema>;

export type CreateVerificationToken = (args: { userId: UserId; email: string }) => Promise<VerificationToken>;

export type VerifyEmailToken = (token: VerificationToken) => Promise<
	| { ok: true; userId: UserId; email: string }
	| { ok: false; reason: "invalid-token" }
>;

/** Erase every verification token a user holds, as part of account deletion.
 * Keyed by userId (not email) so it sidesteps email-casing entirely. The table
 * has a TTL, but deletion must remove the `{userId, email}` remnant immediately
 * rather than let it linger for the verification window. */
export type DeleteVerificationTokensByUserId = (userId: UserId) => Promise<void>;
