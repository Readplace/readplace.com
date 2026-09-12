import { createHmac } from "node:crypto";
import { initRefreshProof, refreshContext } from "./evidence";

it("signs an exact attempt without retaining the refresh token", () => {
	const proof = initRefreshProof("secret");
	const attempt = proof.attempt("credential", 123);
	expect(proof.verify(proof.sign(attempt))).toEqual(attempt);
	expect(attempt.fingerprint).toBe(proof.fingerprint("credential"));
	expect(proof.fingerprint("other")).toHaveLength(64);
});

it.each(["", "payload", ".signature", "payload.", "payload.signature.extra", "payload.short", `payload.${"0".repeat(64)}`])("rejects forged proof %s", value => {
	expect(initRefreshProof("secret").verify(value)).toBeUndefined();
});

it.each(["not json", "{}"])("rejects signed malformed metadata", value => {
	const payload = Buffer.from(value).toString("base64url");
	const signature = createHmac("sha256", "secret").update(`oauth-recovery\0${payload}`).digest("hex");
	expect(initRefreshProof("secret").verify(`${payload}.${signature}`)).toBeUndefined();
});

it("isolates concurrent request attribution", async () => {
	const values = await Promise.all(["one", "two"].map(reason => refreshContext.run({ reason }, async () => {
		await Promise.resolve();
		return refreshContext.getStore()?.reason;
	})));
	expect(values).toEqual(["one", "two"]);
});
