import { initRefreshProof } from "./refresh-proof";

describe("refresh proof", () => {
	it("persists a nonextractable signing key and binds each fresh proof to the exact request", async () => {
		let counter = 0;
		const proof = initRefreshProof({ crypto, now: () => 1_800_000_000_123, uuid: () => `proof-${++counter}` });
		const key = await proof.createKey();
		expect(key.privateKey.extractable).toBe(false);
		await expect(crypto.subtle.exportKey("jwk", key.privateKey)).rejects.toThrow();
		const verifier = await crypto.subtle.importKey("jwk", key.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
		for (const nonce of [undefined, "server-nonce"]) {
			const signed = await proof.sign({ key: structuredClone(key), url: "https://readplace.test/oauth/token?ignored=true#fragment", body: "exact=body+bytes", operationId: "operation", nonce });
			const [header, payload, signature] = signed.split(".");
			expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ typ: "dpop+jwt", alg: "ES256", jwk: { kty: "EC", crv: "P-256", x: key.publicJwk.x, y: key.publicJwk.y } });
			const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
			expect(claims).toEqual({
				jti: `proof-${counter}`, htm: "POST", htu: "https://readplace.test/oauth/token", iat: 1_800_000_000,
				readplace_operation_id: "operation", readplace_body_sha256: Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("exact=body+bytes"))).toString("base64url"),
				...(nonce === undefined ? {} : { nonce }),
			});
			expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
		}
	});
});
