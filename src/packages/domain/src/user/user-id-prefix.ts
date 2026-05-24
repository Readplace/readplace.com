import { z } from "zod";
import type { UserId } from "./user.types";

export const USER_ID_PREFIX_LENGTH = 6;

const USER_ID_PREFIX_PATTERN = /^[0-9a-f]{6}$/;

export type UserIdPrefix = string & { readonly __brand: "UserIdPrefix" };

export const UserIdPrefixSchema = z
	.string()
	.regex(USER_ID_PREFIX_PATTERN)
	.transform((s): UserIdPrefix => s as UserIdPrefix);

/** Extracts the first 6 characters of a UserId as the prefix for sharing/GSI lookups. */
export function userIdPrefixFrom(userId: UserId): UserIdPrefix {
	return userId.slice(0, USER_ID_PREFIX_LENGTH).toLowerCase() as UserIdPrefix;
}

/** Validates an external string (e.g. utm_content) as a well-formed 6-hex-char prefix. */
export function parseUserIdPrefix(value: string | undefined): UserIdPrefix | null {
	if (value === undefined) return null;
	const result = UserIdPrefixSchema.safeParse(value.toLowerCase());
	return result.success ? result.data : null;
}
