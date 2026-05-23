import type { UserId } from "@packages/domain/user";

const PREFIX_LENGTH = 6;

export function shareUserIdPrefix(userId: UserId): string {
	return userId.slice(0, PREFIX_LENGTH);
}
