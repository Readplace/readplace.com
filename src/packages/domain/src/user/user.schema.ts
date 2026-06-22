import { z } from "zod";

export const UserIdSchema = z.string().brand<"UserId">();
export type UserId = z.infer<typeof UserIdSchema>;

/** The id of the principal a request is *running as* — the user who presented a
 * validated session cookie or OAuth bearer token. It carries both brands, so it
 * widens to `UserId` wherever the store accepts a plain id, but a plain `UserId`
 * (e.g. one read off a row, an event payload, or a tool argument) is NOT
 * assignable here. That makes "use a caller-supplied id as the current user" a
 * compile error, not a runtime audit. Minted only by `authenticatedUserIdFrom`
 * at request-auth boundaries — see authenticated-principal-mint-sites.test.ts. */
const AuthenticatedUserIdSchema = UserIdSchema.brand<"AuthenticatedUserId">();
export type AuthenticatedUserId = z.infer<typeof AuthenticatedUserIdSchema>;

/** Mint the authenticated principal from the id carried by a validated session
 * or bearer token. The ONLY producer of an `AuthenticatedUserId`; its call sites
 * are restricted to the auth boundary and enforced by a test. */
export function authenticatedUserIdFrom(userId: string): AuthenticatedUserId {
	return AuthenticatedUserIdSchema.parse(userId);
}
