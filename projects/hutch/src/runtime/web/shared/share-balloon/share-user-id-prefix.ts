import type { UserId } from "@packages/domain/user";
import { type UserIdPrefix, userIdPrefixFrom } from "@packages/domain/user";

export function shareUserIdPrefix(userId: UserId): UserIdPrefix {
	return userIdPrefixFrom(userId);
}
