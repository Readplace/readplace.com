import assert from "node:assert/strict";
import { isFastlyClientChallenge } from "./fastly-client-challenge";

const CLIENT_CHALLENGE_HTML = [
	"<!DOCTYPE html>",
	'<html lang="en">',
	"  <head>",
	'    <link href="/_fs-ch-1T1wmsGaOgGaSxcX/assets/styles.css" rel="stylesheet" />',
	"    <title>Client Challenge</title>",
	"  </head>",
	"  <body>",
	'    <div id="loading-error" role="alert" aria-live="polite">',
	"      A required part of this site couldn’t load. This may be due to a browser",
	"      extension, network issues, or browser settings.",
	"    </div>",
	"    <script>loadScript('/_fs-ch-1T1wmsGaOgGaSxcX/errors.js')</script>",
	"  </body>",
	"</html>",
].join("\n");

const HTML = { "content-type": "text/html; charset=utf-8" };

function streamedResponse(chunks: readonly string[], init: ResponseInit): Response {
	const encoder = new TextEncoder();
	const pending = [...chunks];
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const next = pending.shift();
				if (next === undefined) controller.close();
				else controller.enqueue(encoder.encode(next));
			},
		}),
		init,
	);
}

describe("isFastlyClientChallenge", () => {
	it("recognises the challenge interstitial served as a 200 HTML page", async () => {
		const response = new Response(CLIENT_CHALLENGE_HTML, { status: 200, headers: HTML });
		expect(await isFastlyClientChallenge(response)).toBe(true);
	});

	it("leaves the recognised challenge readable in full", async () => {
		const response = new Response(CLIENT_CHALLENGE_HTML, { status: 200, headers: HTML });
		await isFastlyClientChallenge(response);
		expect(await response.text()).toBe(CLIENT_CHALLENGE_HTML);
	});

	it("takes an article longer than the inspected bytes for an article, leaving its whole body readable", async () => {
		const chunks = [
			"<!DOCTYPE html><html><head><title>A deep-sea whale necropolis | Nature</title></head><body>",
			`<p>${"The whale falls lie along the abyssal plain. ".repeat(400)}</p>`,
			`<p>${"Sediment cores date the site to the early Pliocene. ".repeat(400)}</p>`,
			"</body></html>",
		];
		const response = streamedResponse(chunks, { status: 200, headers: HTML });
		expect(await isFastlyClientChallenge(response)).toBe(false);
		expect(await response.text()).toBe(chunks.join(""));
	});

	it("lets the answer's own reader cancel it once inspected, as an over-cap body read does", async () => {
		const response = streamedResponse(["<html><body>", "x".repeat(20_000), "y".repeat(20_000)], {
			status: 200,
			headers: HTML,
		});
		expect(await isFastlyClientChallenge(response)).toBe(false);
		assert(response.body, "the inspected answer keeps its body");
		const reader = response.body.getReader();
		await reader.read();
		await expect(reader.cancel()).resolves.toBeUndefined();
	});

	it("needs the challenge title as well as its asset path", async () => {
		const html = CLIENT_CHALLENGE_HTML.replace("<title>Client Challenge</title>", "<title>Checkout</title>");
		const response = new Response(html, { status: 200, headers: HTML });
		expect(await isFastlyClientChallenge(response)).toBe(false);
	});

	it("needs the challenge asset path as well as its title", async () => {
		const html = CLIENT_CHALLENGE_HTML.replaceAll("/_fs-ch-1T1wmsGaOgGaSxcX/", "/static/");
		const response = new Response(html, { status: 200, headers: HTML });
		expect(await isFastlyClientChallenge(response)).toBe(false);
	});

	it("finds markers that a chunk boundary splits", async () => {
		const splitAt = CLIENT_CHALLENGE_HTML.indexOf("Client Challenge") + "Client".length;
		const response = streamedResponse(
			[CLIENT_CHALLENGE_HTML.slice(0, splitAt), CLIENT_CHALLENGE_HTML.slice(splitAt)],
			{ status: 200, headers: HTML },
		);
		expect(await isFastlyClientChallenge(response)).toBe(true);
	});

	it("reads on into later chunks while still within the leading 16 KiB", async () => {
		const response = streamedResponse(
			[`<!DOCTYPE html><html><head>${" ".repeat(10_000)}`, CLIENT_CHALLENGE_HTML],
			{ status: 200, headers: HTML },
		);
		expect(await isFastlyClientChallenge(response)).toBe(true);
	});

	it("looks for the markers only within the leading 16 KiB", async () => {
		const response = streamedResponse(
			[`<!DOCTYPE html><html><head>${" ".repeat(16_384)}`, CLIENT_CHALLENGE_HTML],
			{ status: 200, headers: HTML },
		);
		expect(await isFastlyClientChallenge(response)).toBe(false);
	});

	it("never takes a body that is not labelled HTML for the challenge", async () => {
		const pdf = new Response(CLIENT_CHALLENGE_HTML, { status: 200, headers: { "content-type": "application/pdf" } });
		const unlabelled = new Response(new TextEncoder().encode(CLIENT_CHALLENGE_HTML), { status: 200 });
		expect(await isFastlyClientChallenge(pdf)).toBe(false);
		expect(await isFastlyClientChallenge(unlabelled)).toBe(false);
	});

	it("leaves a non-2xx answer to its status", async () => {
		const response = new Response(CLIENT_CHALLENGE_HTML, { status: 503, headers: HTML });
		expect(await isFastlyClientChallenge(response)).toBe(false);
	});

	it("takes an HTML answer with no body for an answer, not a challenge", async () => {
		const response = new Response(null, { status: 200, headers: HTML });
		expect(await isFastlyClientChallenge(response)).toBe(false);
	});

	it("propagates a body that fails while its leading bytes are read", async () => {
		const response = new Response(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					controller.error(new TypeError("terminated"));
				},
			}),
			{ status: 200, headers: HTML },
		);
		await expect(isFastlyClientChallenge(response)).rejects.toThrow("terminated");
	});

	it("leaves no rejection unhandled when the body later fails to cancel", async () => {
		const unhandled: unknown[] = [];
		const recordUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", recordUnhandled);
		try {
			const response = new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(`<html><body>${"x".repeat(20_000)}`));
					},
					cancel() {
						throw new Error("connection already reset");
					},
				}),
				{ status: 200, headers: HTML },
			);
			expect(await isFastlyClientChallenge(response)).toBe(false);
			assert(response.body, "the inspected answer keeps its body");
			await expect(response.body.cancel()).rejects.toThrow("connection already reset");
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", recordUnhandled);
		}
	});
});
