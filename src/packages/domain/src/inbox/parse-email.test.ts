import assert from "node:assert/strict";
import { parseEmail } from "./parse-email";

const RECEIVED_AT = "2026-06-24T10:00:00.000Z";

function eml(...lines: string[]): Buffer {
	return Buffer.from(lines.join("\r\n"), "utf8");
}

function parse(raw: Buffer) {
	return parseEmail({ raw, receivedAt: RECEIVED_AT });
}

/** A 1×1 transparent PNG, base64. */
const PNG_1X1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("parseEmail", () => {
	it("extracts both parts of a multipart/alternative message and ignores the Date header", async () => {
		const result = await parse(
			eml(
				"From: News <news@example.com>",
				"To: in-3f9a2c@read.place",
				"Subject: Weekly digest",
				"Message-ID: <week-1@example.com>",
				"Date: garbage-not-a-real-date",
				"MIME-Version: 1.0",
				'Content-Type: multipart/alternative; boundary="b1"',
				"",
				"--b1",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"Plain version here",
				"--b1",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>HTML version here</p>",
				"--b1--",
				"",
			),
		);

		assert(result.ok);
		expect(result.email.from).toBe("news@example.com");
		expect(result.email.subject).toBe("Weekly digest");
		expect(result.email.text).toContain("Plain version here");
		expect(result.email.html).toContain("HTML version here");
		expect(result.email.messageId).toContain("week-1@example.com");
		// receivedAt comes from the injected SES time, not the unparseable Date header.
		expect(result.email.receivedAt).toBe(RECEIVED_AT);
	});

	it("handles an HTML-only message with no text/plain fallback", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: HtmlOnly",
				"Message-ID: <h@x>",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Only HTML</p>",
			),
		);

		assert(result.ok);
		expect(result.email.html).toContain("Only HTML");
		expect(result.email.text).toBe("");
	});

	it("synthesizes a <pre> HTML body from a text-only message so the View tab is never blank", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: TextOnly",
				"Message-ID: <t@x>",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"Just text here",
			),
		);

		assert(result.ok);
		expect(result.email.text).toContain("Just text here");
		// No text/html part: the renderable body is synthesized from the plain text
		// (wrapped in <pre>) instead of being left empty, which would render blank.
		expect(result.email.html).toContain("<pre>");
		expect(result.email.html).toContain("Just text here");
	});

	it("HTML-escapes a synthesized text-only body so markup in the text renders literally", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: TextWithMarkup",
				"Message-ID: <txt-markup@x>",
				"Content-Type: text/plain; charset=utf-8",
				"",
				`Tags <b> & "quotes" 'apostrophes' stay literal`,
			),
		);

		assert(result.ok);
		expect(result.email.html).toContain("&lt;b&gt;");
		expect(result.email.html).toContain("&amp;");
		expect(result.email.html).toContain("&quot;");
		expect(result.email.html).toContain("&#39;");
		// The raw tag never survives as real markup.
		expect(result.email.html).not.toContain("<b>");
	});

	it("decodes a quoted-printable body with soft breaks and a Latin-1 subject, and tolerates a missing From", async () => {
		const result = await parse(
			eml(
				"Subject: =?ISO-8859-1?Q?caf=E9?=",
				"Message-ID: <qp@x>",
				"Content-Type: text/plain; charset=utf-8",
				"Content-Transfer-Encoding: quoted-printable",
				"",
				"Caf=C3=A9=20time, soft=",
				"wrapped.",
			),
		);

		assert(result.ok);
		expect(result.email.subject).toBe("café");
		expect(result.email.text).toContain("Café time, softwrapped.");
		expect(result.email.from).toBe("");
	});

	it("decodes an RFC-2047 base64 subject containing an emoji", async () => {
		const encoded = Buffer.from("🚀 Launch!", "utf8").toString("base64");
		const result = await parse(
			eml(
				"From: a@b.com",
				`Subject: =?UTF-8?B?${encoded}?=`,
				"Message-ID: <emoji@x>",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"body",
			),
		);

		assert(result.ok);
		expect(result.email.subject).toBe("🚀 Launch!");
	});

	it("resolves a cid: inline image bracket-aware and carries its bytes", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: WithImage",
				"Message-ID: <img@x>",
				"MIME-Version: 1.0",
				'Content-Type: multipart/related; boundary="r1"',
				"",
				"--r1",
				"Content-Type: text/html; charset=utf-8",
				"",
				'<p><img src="cid:logo@x"></p>',
				"--r1",
				"Content-Type: image/png",
				"Content-Transfer-Encoding: base64",
				"Content-ID: <logo@x>",
				'Content-Disposition: inline; filename="logo.png"',
				"",
				PNG_1X1,
				"--r1--",
			),
		);

		assert(result.ok);
		expect(result.email.html).toContain("email://cid/logo@x");
		expect(result.email.html).not.toContain("cid:logo@x");
		expect(result.email.inlineImages).toHaveLength(1);
		expect(result.email.inlineImages[0].cid).toBe("logo@x");
		expect(result.email.inlineImages[0].contentType).toBe("image/png");
		expect(result.email.inlineImages[0].body.byteLength).toBeGreaterThan(0);
	});

	it("rewrites a cid: image whose Content-ID contains a $ without expanding it as a replacement pattern", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: DollarCid",
				"Message-ID: <dollar@x>",
				"MIME-Version: 1.0",
				'Content-Type: multipart/related; boundary="r1"',
				"",
				"--r1",
				"Content-Type: text/html; charset=utf-8",
				"",
				'<p><img src="cid:logo$&img@x"></p>',
				"--r1",
				"Content-Type: image/png",
				"Content-Transfer-Encoding: base64",
				"Content-ID: <logo$&img@x>",
				'Content-Disposition: inline; filename="logo.png"',
				"",
				PNG_1X1,
				"--r1--",
			),
		);

		assert(result.ok);
		// A string replacement would treat the `$&` as "the matched text" and corrupt
		// the URL; the function replacement keeps the cid literal, so it still matches
		// the inline-image key the receive path inlines.
		expect(result.email.inlineImages[0].cid).toBe("logo$&img@x");
		expect(result.email.html).toContain("email://cid/logo$&img@x");
		expect(result.email.html).not.toContain("cid:logo");
	});

	it("tolerates a non-inline attachment with no Content-ID without treating it as an image", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: WithAttachment",
				"Message-ID: <att@x>",
				"MIME-Version: 1.0",
				'Content-Type: multipart/mixed; boundary="m1"',
				"",
				"--m1",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Body text</p>",
				"--m1",
				"Content-Type: application/pdf",
				"Content-Transfer-Encoding: base64",
				'Content-Disposition: attachment; filename="doc.pdf"',
				"",
				"JVBERi0xLjQK",
				"--m1--",
			),
		);

		assert(result.ok);
		expect(result.email.html).toContain("Body text");
		expect(result.email.inlineImages).toHaveLength(0);
	});

	it("synthesizes a stable Message-ID when the email omits one", async () => {
		const raw = eml(
			"From: a@b.com",
			"Subject: NoMsgId",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"body",
		);

		const first = await parse(raw);
		const second = await parse(raw);

		assert(first.ok);
		assert(second.ok);
		expect(first.email.messageId).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(second.email.messageId).toBe(first.email.messageId);
	});

	it("returns an empty subject when the header is absent", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Message-ID: <nosub@x>",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"body",
			),
		);

		assert(result.ok);
		expect(result.email.subject).toBe("");
	});

	it("strips a UTF-8 BOM at the start of the body", async () => {
		const result = await parse(
			Buffer.from(
				"Content-Type: text/plain; charset=utf-8\r\n\r\n﻿Hello there",
				"utf8",
			),
		);

		assert(result.ok);
		expect(result.email.text.trimEnd()).toBe("Hello there");
	});

	it("degrades to unparseable when there is no renderable body", async () => {
		const result = await parse(
			eml(
				"From: a@b.com",
				"Subject: NoBody",
				"Message-ID: <nobody@x>",
				"MIME-Version: 1.0",
				'Content-Type: multipart/mixed; boundary="x1"',
				"",
				"--x1",
				"Content-Type: application/octet-stream",
				"Content-Transfer-Encoding: base64",
				'Content-Disposition: attachment; filename="data.bin"',
				"",
				"AAAAAAAA",
				"--x1--",
			),
		);

		expect(result.ok).toBe(false);
	});

	it("degrades to unparseable when postal-mime rejects the structure", async () => {
		let nested = "Content-Type: text/plain\r\n\r\nhi";
		for (let depth = 0; depth < 300; depth++) {
			nested = `Content-Type: multipart/mixed; boundary="b${depth}"\r\n\r\n--b${depth}\r\n${nested}\r\n--b${depth}--`;
		}

		const result = await parse(Buffer.from(nested, "utf8"));

		expect(result.ok).toBe(false);
	});

	it("collects the http(s) List-Unsubscribe targets and drops the mailto one", async () => {
		const result = await parse(
			eml(
				"From: news@example.com",
				"Subject: Digest",
				"Message-ID: <lu@x>",
				"List-Unsubscribe: <mailto:unsub@example.com>, <https://news.example.com/unsub?u=1>",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Body</p>",
			),
		);

		assert(result.ok);
		expect(result.email.listUnsubscribeUrls).toEqual(["https://news.example.com/unsub?u=1"]);
	});

	it("collects targets from every List-Unsubscribe header when the message repeats it", async () => {
		const result = await parse(
			eml(
				"From: news@example.com",
				"Subject: Digest",
				"Message-ID: <lu2@x>",
				"List-Unsubscribe: <https://news.example.com/unsub?u=1>",
				"List-Unsubscribe: <https://lists.example.net/optout>",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Body</p>",
			),
		);

		assert(result.ok);
		expect(result.email.listUnsubscribeUrls).toEqual([
			"https://news.example.com/unsub?u=1",
			"https://lists.example.net/optout",
		]);
	});

	it("surfaces the X-Google-Address-Confirmation header value", async () => {
		const result = await parse(
			eml(
				"From: Gmail Team <forwarding-noreply@google.com>",
				"Subject: (Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com",
				"Message-ID: <gac@x>",
				"X-Google-Address-Confirmation: IxoQly5DrG25IVlwjJRM-AqecpU",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"please click the link below to confirm the request:",
			),
		);

		assert(result.ok);
		expect(result.email.googleAddressConfirmation).toBe("IxoQly5DrG25IVlwjJRM-AqecpU");
	});

	it("leaves the Google address confirmation undefined when the header is absent", async () => {
		const result = await parse(
			eml(
				"From: news@example.com",
				"Subject: Digest",
				"Message-ID: <gac2@x>",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Body</p>",
			),
		);

		assert(result.ok);
		expect(result.email.googleAddressConfirmation).toBeUndefined();
	});

	it("returns no unsubscribe targets when the header is absent", async () => {
		const result = await parse(
			eml(
				"From: news@example.com",
				"Subject: Digest",
				"Message-ID: <lu3@x>",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Body</p>",
			),
		);

		assert(result.ok);
		expect(result.email.listUnsubscribeUrls).toEqual([]);
	});
});
