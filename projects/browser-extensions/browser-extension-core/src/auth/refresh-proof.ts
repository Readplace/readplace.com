/// <reference lib="dom" />
import { fromUint8Array } from "js-base64";

export type RefreshKey = { privateKey: CryptoKey; publicJwk: JsonWebKey };

export function initRefreshProof(deps: { crypto: Crypto; now: () => number; uuid: () => string }) {
	const encode = (bytes: Uint8Array) => fromUint8Array(bytes, true);
	const json = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
	return {
		async createKey(): Promise<RefreshKey> {
			const pair = await deps.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
			return { privateKey: pair.privateKey, publicJwk: await deps.crypto.subtle.exportKey("jwk", pair.publicKey) };
		},
		async sign(input: { key: RefreshKey; url: string; body: string; operationId: string; nonce?: string }): Promise<string> {
			const url = new URL(input.url);
			url.search = "";
			url.hash = "";
			const bodyHash = await deps.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.body));
			const { kty, crv, x, y } = input.key.publicJwk;
			const header = json({ typ: "dpop+jwt", alg: "ES256", jwk: { kty, crv, x, y } });
			const payload = json({
				jti: deps.uuid(), htm: "POST", htu: url.toString(), iat: Math.floor(deps.now() / 1000),
				readplace_operation_id: input.operationId, readplace_body_sha256: encode(new Uint8Array(bodyHash)),
				...(input.nonce === undefined ? {} : { nonce: input.nonce }),
			});
			const message = `${header}.${payload}`;
			const signature = await deps.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, input.key.privateKey, new TextEncoder().encode(message));
			return `${message}.${encode(new Uint8Array(signature))}`;
		},
	};
}
