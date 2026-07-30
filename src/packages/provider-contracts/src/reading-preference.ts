import type { UserId } from "@packages/domain/user";

/** Writes the user's free-text reading preference, replacing whatever was there
 * before. Last write wins — the reader edits one preference, never appends to a
 * history — so a repeated call is idempotent for the same text. */
export type SaveReadingPreference = (params: {
	userId: UserId;
	text: string;
}) => Promise<void>;

/** Reads the user's reading preference, or `undefined` when they have never
 * saved one — the two states drive different renders, so absence is a value the
 * caller must handle rather than an empty string. `updatedAt` is an ISO-8601
 * instant. */
export type GetReadingPreference = (params: {
	userId: UserId;
}) => Promise<{ text: string; updatedAt: string } | undefined>;

export type DeleteReadingPreference = (params: { userId: UserId }) => Promise<void>;
