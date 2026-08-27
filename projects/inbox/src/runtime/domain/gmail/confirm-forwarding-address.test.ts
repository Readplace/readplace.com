import assert from "node:assert/strict";
import { initConfirmForwardingAddress } from "./confirm-forwarding-address";

const VERIFY_URL = "https://mail.google.com/mail/vf-%5BANGjdJ_redacted%5D-M8fzAOTZ";

const SUCCESS_HTML =
	"<html><head><title>Confirmation Success!</title></head><body>" +
	"<p>reader@gmail.com may now forward mail to <strong>gmail-a7b2c9@read.place</strong>.</p>" +
	"</body></html>";

const INTERSTITIAL_HTML =
	"<html><head><title>Confirmation</title></head><body>" +
	"<p>Please confirm forwarding mail of reader@gmail.com.</p>" +
	'<form action="" method="post"><p><input type="submit" value="Confirm"></p></form>' +
	"</body></html>";

function confirmWith(body: string, status: number) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const fetchFake: typeof globalThis.fetch = async (input, init) => {
		calls.push({ url: String(input), init });
		return new Response(body, { status, headers: { "content-type": "text/html" } });
	};
	const confirm = initConfirmForwardingAddress({ fetch: fetchFake, timeoutMs: 5_000 });
	return { confirm, calls };
}

describe("initConfirmForwardingAddress", () => {
	it("confirms with an empty-body POST and recognises the success page", async () => {
		const { confirm, calls } = confirmWith(SUCCESS_HTML, 200);

		const result = await confirm({ verifyUrl: VERIFY_URL });

		assert.deepEqual(result, { ok: true });
		assert.equal(calls[0].url, VERIFY_URL);
		assert.equal(calls[0].init?.method, "POST");
		assert.equal(calls[0].init?.body, undefined);
	});

	it("recognises the interstitial by its Confirm form, not by its localised title", async () => {
		const { confirm } = confirmWith(INTERSTITIAL_HTML, 200);

		const result = await confirm({ verifyUrl: VERIFY_URL });

		assert.deepEqual(result, { ok: false, reason: "not-confirmed" });
	});

	it("reports a spent or expired token", async () => {
		const { confirm } = confirmWith("<html><title>Temporary Error</title></html>", 400);

		const result = await confirm({ verifyUrl: VERIFY_URL });

		assert.deepEqual(result, { ok: false, reason: "token-rejected", status: 400 });
	});

	it("reports any other status as Google being unavailable", async () => {
		const { confirm } = confirmWith("", 503);

		const result = await confirm({ verifyUrl: VERIFY_URL });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 503 });
	});

	it("refuses to POST anywhere but Google's confirmation path", async () => {
		const { confirm, calls } = confirmWith(SUCCESS_HTML, 200);

		const result = await confirm({
			verifyUrl: "https://attacker.example/mail/vf-whatever",
		});

		assert.deepEqual(result, { ok: false, reason: "invalid-url" });
		assert.deepEqual(calls, []);
	});

	it("refuses a path that normalises onto the cancel endpoint", async () => {
		const { confirm, calls } = confirmWith(SUCCESS_HTML, 200);

		const result = await confirm({
			verifyUrl: "https://mail.google.com/mail/vf-x/../uf-y",
		});

		assert.deepEqual(result, { ok: false, reason: "invalid-url" });
		assert.deepEqual(calls, []);
	});

	it("refuses a non-http scheme", async () => {
		const { confirm, calls } = confirmWith(SUCCESS_HTML, 200);

		const result = await confirm({ verifyUrl: "file:///etc/passwd" });

		assert.deepEqual(result, { ok: false, reason: "invalid-url" });
		assert.deepEqual(calls, []);
	});

	it("refuses plaintext http even on the confirmation host and path", async () => {
		const { confirm, calls } = confirmWith(SUCCESS_HTML, 200);

		const result = await confirm({ verifyUrl: "http://mail.google.com/mail/vf-token" });

		assert.deepEqual(result, { ok: false, reason: "invalid-url" });
		assert.deepEqual(calls, []);
	});

	it("refuses the cancel path even on the right host", async () => {
		const { confirm, calls } = confirmWith(SUCCESS_HTML, 200);

		const result = await confirm({
			verifyUrl: "https://mail.google.com/mail/uf-%5Bcancel%5D-token",
		});

		assert.deepEqual(result, { ok: false, reason: "invalid-url" });
		assert.deepEqual(calls, []);
	});
});
