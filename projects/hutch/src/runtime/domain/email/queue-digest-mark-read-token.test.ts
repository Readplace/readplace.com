import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initQueueDigestMarkReadToken } from "./queue-digest-mark-read-token";
import { initQueueDigestUnsubscribeToken } from "./queue-digest-unsubscribe-token";

const READER = UserIdSchema.parse("0f3c9a1b2d4e5f60718293a4b5c6d7e8");
const FIRST_ARTICLE = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const SECOND_ARTICLE = ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210");
const DIGEST = { userId: READER, articleIds: [FIRST_ARTICLE, SECOND_ARTICLE] };

function hmacHex(input: { secret: string; message: string }): string {
	return createHmac("sha256", input.secret).update(input.message).digest("hex");
}

function encodedPayload(payload: { userId: string; articleIds: string[] }): string {
	return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

const DIGEST_PAYLOAD = encodedPayload({
	userId: READER,
	articleIds: ["0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"],
});

describe("initQueueDigestMarkReadToken", () => {
	it("signs the reader and the digest's article ids with an HMAC bound to the queue-digest-mark-read purpose", () => {
		const token = initQueueDigestMarkReadToken("salt").sign(DIGEST);

		expect(token).toBe(
			`${DIGEST_PAYLOAD}.${hmacHex({ secret: "salt", message: `queue-digest-mark-read\0${DIGEST_PAYLOAD}` })}`,
		);
	});

	it("verifies its own token back to the reader and exactly the article ids it was signed with, in order", () => {
		const markReadToken = initQueueDigestMarkReadToken("salt");

		const verified = markReadToken.verify(markReadToken.sign(DIGEST));

		assert(verified, "a token this signer minted must verify");
		expect(verified.userId).toBe(READER);
		expect(verified.articleIds.map((id) => id.value)).toEqual([
			"0123456789abcdef0123456789abcdef",
			"fedcba9876543210fedcba9876543210",
		]);
	});

	it("rejects a token whose payload was swapped for another reader's, keeping the signature", () => {
		const markReadToken = initQueueDigestMarkReadToken("salt");
		const signature = markReadToken.sign(DIGEST).split(".")[1];
		const anotherReader = encodedPayload({
			userId: "another-reader",
			articleIds: ["0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"],
		});

		expect(markReadToken.verify(`${anotherReader}.${signature}`)).toBeUndefined();
	});

	it("rejects a token whose payload gained an article the email never listed, keeping the signature", () => {
		const markReadToken = initQueueDigestMarkReadToken("salt");
		const signature = markReadToken.sign(DIGEST).split(".")[1];
		const widened = encodedPayload({
			userId: READER,
			articleIds: [
				"0123456789abcdef0123456789abcdef",
				"fedcba9876543210fedcba9876543210",
				"00000000000000000000000000000000",
			],
		});

		expect(markReadToken.verify(`${widened}.${signature}`)).toBeUndefined();
	});

	it("rejects a token whose signature was altered at the same length", () => {
		const markReadToken = initQueueDigestMarkReadToken("salt");
		const token = markReadToken.sign(DIGEST);
		const lastCharacter = token.slice(-1);
		const tampered = `${token.slice(0, -1)}${lastCharacter === "0" ? "1" : "0"}`;

		expect(markReadToken.verify(tampered)).toBeUndefined();
	});

	it("rejects a token signed with a different secret", () => {
		const signedElsewhere = initQueueDigestMarkReadToken("other-salt").sign(DIGEST);

		expect(initQueueDigestMarkReadToken("salt").verify(signedElsewhere)).toBeUndefined();
	});

	it("rejects an HMAC of the same payload minted for the unsubscribe purpose", () => {
		const unsubscribeSignature = hmacHex({ secret: "salt", message: `queue-digest-unsubscribe\0${DIGEST_PAYLOAD}` });

		expect(
			initQueueDigestMarkReadToken("salt").verify(`${DIGEST_PAYLOAD}.${unsubscribeSignature}`),
		).toBeUndefined();
	});

	it("rejects the same reader's unsubscribe token signed with the same secret", () => {
		const unsubscribeToken = initQueueDigestUnsubscribeToken("salt").sign(READER);

		expect(initQueueDigestMarkReadToken("salt").verify(unsubscribeToken)).toBeUndefined();
	});

	it("is itself refused by the unsubscribe verifier signed with the same secret", () => {
		const markReadToken = initQueueDigestMarkReadToken("salt").sign(DIGEST);

		expect(initQueueDigestUnsubscribeToken("salt").verify(markReadToken)).toBeUndefined();
	});

	it.each([
		["an empty token", ""],
		["a token without a signature", DIGEST_PAYLOAD],
		["a token with an empty signature", `${DIGEST_PAYLOAD}.`],
		["a token with an empty payload", `.${hmacHex({ secret: "salt", message: "queue-digest-mark-read\0" })}`],
		["a signature of the wrong length", `${DIGEST_PAYLOAD}.abc123`],
	])("rejects %s without throwing", (_description, token) => {
		expect(initQueueDigestMarkReadToken("salt").verify(token)).toBeUndefined();
	});

	it("rejects a valid token with an extra dot segment appended", () => {
		const markReadToken = initQueueDigestMarkReadToken("salt");

		expect(markReadToken.verify(`${markReadToken.sign(DIGEST)}.extra`)).toBeUndefined();
	});
});
