import { dynamoField } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { z } from "zod";

/** How long a session lives. hutch stamps `expiresAt = now + this` on every
 * session it writes; the DynamoDB TTL evicts rows past it and the read path
 * treats a lingering past-TTL row as no session. Single-sourced so the writer
 * (hutch) and every reader agree on the window. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The shape of a row in hutch's sessions table — the single contract shared by
 * hutch (which writes sessions on login) and every frontend that reads one to
 * resolve a request's login state. All-required: this is an internal,
 * single-repo contract, not an evolving public wire format. `emailVerified` is a
 * `dynamoField` because DynamoDB stores a missing boolean as absent, not false. */
export const SessionRow = z.object({
	sessionId: z.string(),
	userId: UserIdSchema,
	expiresAt: z.number(),
	emailVerified: dynamoField(z.boolean()),
});
