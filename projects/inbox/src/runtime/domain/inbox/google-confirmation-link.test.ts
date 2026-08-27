import assert from "node:assert/strict";
import { parseEmail } from "@packages/domain/inbox";
import {
	GOOGLE_FORWARDING_SENDER,
	findGoogleForwardingConfirmationUrl,
} from "./google-confirmation-link";

const VERIFY_PATH =
	"/mail/vf-%5BANGjdJ_HBdB9U6XGMf6d_lgGyXVy3LZxppBS1h68jxB5p0fvJA3XVbwLd5xcY68i30P2TCd3aE%5D-M8fzAOTZVlVJYOhyQMmbMDWQVks";
const CANCEL_PATH = "/mail/uf-%5BANGjdJ8kFnuVTR76z1FSIMUUpjb0nEYollD0tTOY5hgh%5D-M8fzAOTZVlVJYOhy";

/** Google's real forwarding-confirmation message, captured on 2026-08-24 with the
 * single-use tokens redacted: text/plain only, no HTML part, the confirm link on
 * its own line and the cancel link further down. */
function realConfirmationEml(): Buffer {
	return Buffer.from(
		[
			"From: Gmail Team <forwarding-noreply@google.com>",
			"To: gmail-a7b2c9@read.place",
			"Subject: (Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com",
			"Message-ID: <CAD4-redacted@mail.gmail.com>",
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=\"UTF-8\"",
			"X-Google-Address-Confirmation: IxoQly5DrG25IVlwjJRM-AqecpU",
			"",
			"reader@gmail.com has requested to automatically forward mail to",
			"your email",
			"address gmail-a7b2c9@read.place.",
			"",
			"To allow reader@gmail.com to automatically forward mail to your address,",
			"please click the link below to confirm the request:",
			"",
			`https://mail-settings.google.com${VERIFY_PATH}`,
			"",
			"If you click the link and it appears to be broken, please copy and paste it",
			"into a new browser window.",
			"",
			"If you don't want to forward mail, you can cancel the request:",
			"",
			`https://mail-settings.google.com${CANCEL_PATH}`,
			"",
		].join("\r\n"),
		"utf8",
	);
}

function candidate(overrides: Partial<Parameters<typeof findGoogleForwardingConfirmationUrl>[0]>) {
	return {
		from: GOOGLE_FORWARDING_SENDER,
		googleAddressConfirmation: "IxoQly5DrG25IVlwjJRM-AqecpU",
		html: "",
		text: "",
		...overrides,
	};
}

describe("findGoogleForwardingConfirmationUrl", () => {
	it("finds the confirm link in Google's real text-only message, parsed end to end", async () => {
		const parsed = await parseEmail({
			raw: realConfirmationEml(),
			receivedAt: "2026-08-24T00:54:24.000Z",
		});
		assert(parsed.ok);

		const found = findGoogleForwardingConfirmationUrl(parsed.email);

		assert.equal(found, `https://mail.google.com${VERIFY_PATH}`);
	});

	it("ignores a message with no Google address-confirmation header", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({
				googleAddressConfirmation: undefined,
				text: `https://mail-settings.google.com${VERIFY_PATH}`,
			}),
		);
		assert.equal(found, undefined);
	});

	it("ignores a message carrying the header but sent by somebody else", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({
				from: "attacker@example.com",
				text: `https://mail-settings.google.com${VERIFY_PATH}`,
			}),
		);
		assert.equal(found, undefined);
	});

	it("matches the sender case-insensitively and ignores surrounding whitespace", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({
				from: " Forwarding-Noreply@Google.com ",
				text: `https://mail-settings.google.com${VERIFY_PATH}`,
			}),
		);
		assert.equal(found, `https://mail.google.com${VERIFY_PATH}`);
	});

	it("also finds the link in an HTML anchor, should Google ever send an HTML part", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ html: `<a href="https://mail-settings.google.com${VERIFY_PATH}">Confirm</a>` }),
		);
		assert.equal(found, `https://mail.google.com${VERIFY_PATH}`);
	});

	it("strips trailing sentence punctuation from a plain-text token", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `Confirm here: https://mail.google.com${VERIFY_PATH}.` }),
		);
		assert.equal(found, `https://mail.google.com${VERIFY_PATH}`);
	});

	it("never returns the cancel link", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `https://mail-settings.google.com${CANCEL_PATH}` }),
		);
		assert.equal(found, undefined);
	});

	it("rejects a confirmation-shaped path on another Google host", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `https://sites.google.com${VERIFY_PATH}` }),
		);
		assert.equal(found, undefined);
	});

	it("rejects a look-alike host that merely ends with the real one", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `https://mail.google.com.attacker.example${VERIFY_PATH}` }),
		);
		assert.equal(found, undefined);
	});

	it("rejects a non-http scheme", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `javascript:alert(1) mailto:someone@mail.google.com${VERIFY_PATH}` }),
		);
		assert.equal(found, undefined);
	});

	it("pins the scheme to https so a plaintext link is never posted in the clear", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `http://mail.google.com${VERIFY_PATH}` }),
		);
		assert.equal(found, `https://mail.google.com${VERIFY_PATH}`);
	});

	it("drops a port and credentials from the candidate, keeping path and query byte-identical", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: `https://evil:pw@mail.google.com:8443${VERIFY_PATH}?q=1#frag` }),
		);
		assert.equal(found, `https://mail.google.com${VERIFY_PATH}?q=1`);
	});

	it("rejects a non-confirmation path on a confirmation host", () => {
		const found = findGoogleForwardingConfirmationUrl(
			candidate({ text: "https://mail.google.com/mail/u/0/" }),
		);
		assert.equal(found, undefined);
	});
});
