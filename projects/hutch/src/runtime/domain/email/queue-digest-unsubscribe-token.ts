import { createHmac, timingSafeEqual } from "node:crypto";
import { UserIdSchema, type UserId } from "@packages/domain/user";

const QUEUE_DIGEST_UNSUBSCRIBE_PURPOSE = "queue-digest-unsubscribe";

export function initQueueDigestUnsubscribeToken(secret: string) {
	const signatureFor = (userId: string) =>
		createHmac("sha256", secret).update(`${QUEUE_DIGEST_UNSUBSCRIBE_PURPOSE}\0${userId}`).digest("hex");
	return {
		sign(userId: UserId): string {
			return `${userId}.${signatureFor(userId)}`;
		},
		verify(token: string): UserId | undefined {
			const [userId, signature, extra] = token.split(".");
			if (!userId || !signature || extra !== undefined) return undefined;
			const expected = Buffer.from(signatureFor(userId));
			const actual = Buffer.from(signature);
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
			return UserIdSchema.parse(userId);
		},
	};
}
