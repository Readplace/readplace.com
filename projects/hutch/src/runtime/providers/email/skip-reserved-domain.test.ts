import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initSkipReservedDomain } from "./skip-reserved-domain";

const MESSAGE = {
	from: "Fayner from Readplace <fayner@readplace.com>",
	subject: "how did your trial go?",
	html: "<p>hi</p>",
};

function build(logger: HutchLogger) {
	const inner = initInMemoryEmail();
	const { sendEmail } = initSkipReservedDomain({
		sendEmail: inner.sendEmail,
		logger,
	});
	return { sendEmail, getSentEmails: inner.getSentEmails };
}

function captureWarnings(): { logger: HutchLogger; warnings: unknown[][] } {
	const warnings: unknown[][] = [];
	const logger = HutchLogger.from({
		...noopLogger,
		warn: (...args: unknown[]) => {
			warnings.push(args);
		},
	});
	return { logger, warnings };
}

describe("skip-reserved-domain", () => {
	it("forwards a deliverable recipient to the wrapped sender", async () => {
		const { sendEmail, getSentEmails } = build(HutchLogger.from(noopLogger));

		await sendEmail({ ...MESSAGE, to: "reader@readplace.com" });

		assert.equal(getSentEmails().length, 1);
		assert.equal(getSentEmails()[0].to, "reader@readplace.com");
	});

	it("drops a reserved second-level domain so it never reaches the provider", async () => {
		const { sendEmail, getSentEmails } = build(HutchLogger.from(noopLogger));

		await sendEmail({ ...MESSAGE, to: "oauth-revoke-e2e@example.com" });

		assert.deepEqual(getSentEmails(), []);
	});

	it("drops every reserved second-level domain, not just example.com", async () => {
		const { sendEmail, getSentEmails } = build(HutchLogger.from(noopLogger));

		await sendEmail({ ...MESSAGE, to: "someone@example.net" });
		await sendEmail({ ...MESSAGE, to: "someone@example.org" });

		assert.deepEqual(getSentEmails(), []);
	});

	it("drops a reserved TLD", async () => {
		const { sendEmail, getSentEmails } = build(HutchLogger.from(noopLogger));

		await sendEmail({ ...MESSAGE, to: "someone@staging.test" });

		assert.deepEqual(getSentEmails(), []);
	});

	it("matches the reserved domain regardless of case", async () => {
		const { sendEmail, getSentEmails } = build(HutchLogger.from(noopLogger));

		await sendEmail({ ...MESSAGE, to: "Someone@EXAMPLE.CoM" });

		assert.deepEqual(getSentEmails(), []);
	});

	it("keeps a deliverable address that merely looks synthetic", async () => {
		const { sendEmail, getSentEmails } = build(HutchLogger.from(noopLogger));

		await sendEmail({ ...MESSAGE, to: "test+2@readplace.com" });

		assert.equal(getSentEmails().length, 1);
	});

	it("warns with the reserved domain but never the recipient address", async () => {
		const { logger, warnings } = captureWarnings();
		const { sendEmail } = build(logger);

		await sendEmail({ ...MESSAGE, to: "oauth-revoke-e2e@example.com" });

		assert.equal(warnings.length, 1);
		assert.deepEqual(warnings[0][1], {
			domain: "example.com",
			subject: MESSAGE.subject,
		});
		assert.equal(JSON.stringify(warnings).includes("oauth-revoke-e2e"), false);
	});

	it("does not warn when the recipient is deliverable", async () => {
		const { logger, warnings } = captureWarnings();
		const { sendEmail } = build(logger);

		await sendEmail({ ...MESSAGE, to: "reader@readplace.com" });

		assert.deepEqual(warnings, []);
	});
});
