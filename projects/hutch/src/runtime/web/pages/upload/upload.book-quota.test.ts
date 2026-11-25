import express from "express";
import request from "supertest";
import { generateCspNonce } from "@packages/web-shell";
import { type UploadOutcomeWriters, writeUploadOutcome } from "./upload.outcome";
import { UPLOAD_PROTOCOL_SIREN } from "./upload.outcome.siren";
import { UPLOAD_OUTCOME_HTML } from "./upload.page";

const retryAt = new Date("2026-11-14T00:00:00.000Z");

function appWriting(writers: UploadOutcomeWriters) {
	const app = express();
	app.post("/received", (req, res) => {
		writeUploadOutcome({
			writers,
			res,
			outcome: { outcome: "book-quota", retryAt },
			context: {
				req,
				bannerState: { isAuthenticated: true, emailVerified: true, cspNonce: generateCspNonce() },
				kinds: [],
				metered: true,
				transcriptAllowanceSeconds: 1200,
			},
		});
	});
	return app;
}

describe("book-quota upload outcome", () => {
	it("redirects a browser to the metered start page carrying the instant it may upload another book", async () => {
		const response = await request(appWriting(UPLOAD_OUTCOME_HTML)).post("/received");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			"/upload?features=transcripts&refused=book-quota&retry_at=2026-11-14T00%3A00%3A00.000Z",
		);
	});

	it("answers a Siren client 422 with the book-quota code and the retry instant", async () => {
		const response = await request(appWriting(UPLOAD_PROTOCOL_SIREN.writers)).post("/received");

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toMatch(/^application\/vnd\.siren\+json/);
		expect(response.body).toEqual({
			class: ["error"],
			properties: {
				code: "book-quota",
				message:
					"You've reached today's limit for book uploads. You can upload another book after Nov 14, 2026, 00:00 UTC.",
				messages: [
					{
						type: "error",
						content: {
							type: "text/html",
							body: "You've reached today's limit for book uploads. You can upload another book after Nov 14, 2026, 00:00 UTC.",
						},
					},
				],
				retryAt: "2026-11-14T00:00:00.000Z",
			},
		});
	});
});
