import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { type ReaderArticleHashId, ReaderArticleHashIdSchema } from "@packages/domain/article";
import { type UserId, UserIdSchema } from "@packages/domain/user";

const QUEUE_DIGEST_MARK_READ_PURPOSE = "queue-digest-mark-read";

const MarkReadPayloadSchema = z.object({
	userId: UserIdSchema,
	articleIds: z.array(ReaderArticleHashIdSchema),
});

export interface QueueDigestMarkRead {
	userId: UserId;
	articleIds: ReaderArticleHashId[];
}

export function initQueueDigestMarkReadToken(secret: string) {
	const signatureFor = (payload: string) =>
		createHmac("sha256", secret).update(`${QUEUE_DIGEST_MARK_READ_PURPOSE}\0${payload}`).digest("hex");
	return {
		sign(input: QueueDigestMarkRead): string {
			const payload = Buffer.from(
				JSON.stringify({ userId: input.userId, articleIds: input.articleIds.map((id) => id.value) }),
			).toString("base64url");
			return `${payload}.${signatureFor(payload)}`;
		},
		verify(token: string): QueueDigestMarkRead | undefined {
			const [payload, signature, extra] = token.split(".");
			if (!payload || !signature || extra !== undefined) return undefined;
			const expected = Buffer.from(signatureFor(payload));
			const actual = Buffer.from(signature);
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
			return MarkReadPayloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")));
		},
	};
}
