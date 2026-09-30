import { createHmac } from "node:crypto";
import { UserIdSchema } from "@packages/domain/user";
import { initQueueDigestUnsubscribeToken } from "./queue-digest-unsubscribe-token";

const READER = UserIdSchema.parse("0f3c9a1b2d4e5f60718293a4b5c6d7e8");

function hmacHex(input: { secret: string; message: string }): string {
	return createHmac("sha256", input.secret).update(input.message).digest("hex");
}

describe("initQueueDigestUnsubscribeToken", () => {
	it("signs the user id with an HMAC bound to the queue-digest-unsubscribe purpose", () => {
		const token = initQueueDigestUnsubscribeToken("salt").sign(READER);

		expect(token).toBe(
			`${READER}.${hmacHex({ secret: "salt", message: `queue-digest-unsubscribe\0${READER}` })}`,
		);
	});

	it("verifies its own token back to the user id", () => {
		const unsubscribeToken = initQueueDigestUnsubscribeToken("salt");

		expect(unsubscribeToken.verify(unsubscribeToken.sign(READER))).toBe(READER);
	});

	it("rejects a token whose user id was swapped for another reader's", () => {
		const unsubscribeToken = initQueueDigestUnsubscribeToken("salt");
		const signature = unsubscribeToken.sign(READER).split(".")[1];

		expect(unsubscribeToken.verify(`another-reader.${signature}`)).toBeUndefined();
	});

	it("rejects a token whose signature was altered at the same length", () => {
		const unsubscribeToken = initQueueDigestUnsubscribeToken("salt");
		const token = unsubscribeToken.sign(READER);
		const lastCharacter = token.slice(-1);
		const tampered = `${token.slice(0, -1)}${lastCharacter === "0" ? "1" : "0"}`;

		expect(unsubscribeToken.verify(tampered)).toBeUndefined();
	});

	it("rejects a token signed with a different secret", () => {
		const signedElsewhere = initQueueDigestUnsubscribeToken("other-salt").sign(READER);

		expect(initQueueDigestUnsubscribeToken("salt").verify(signedElsewhere)).toBeUndefined();
	});

	it("rejects an HMAC of the same user id minted for a different purpose", () => {
		const oauthRecoverySignature = hmacHex({ secret: "salt", message: `oauth-recovery\0${READER}` });

		expect(
			initQueueDigestUnsubscribeToken("salt").verify(`${READER}.${oauthRecoverySignature}`),
		).toBeUndefined();
	});

	it.each([
		["an empty token", ""],
		["a token without a signature", READER],
		["a token with an empty signature", `${READER}.`],
		["a token with an empty user id", `.${hmacHex({ secret: "salt", message: "queue-digest-unsubscribe\0" })}`],
		["a signature of the wrong length", `${READER}.abc123`],
	])("rejects %s without throwing", (_description, token) => {
		expect(initQueueDigestUnsubscribeToken("salt").verify(token)).toBeUndefined();
	});

	it("rejects a valid token with an extra dot segment appended", () => {
		const unsubscribeToken = initQueueDigestUnsubscribeToken("salt");

		expect(unsubscribeToken.verify(`${unsubscribeToken.sign(READER)}.extra`)).toBeUndefined();
	});
});
