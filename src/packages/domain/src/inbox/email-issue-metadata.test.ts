import assert from "node:assert/strict";
import { deriveEmailIssueMetadata } from "./email-issue-metadata";

const ISSUE = {
	subject: "  Employee #1: Yahoo  ",
	senderEmail: "dan@tldr.tech",
	senderName: " TLDR ",
};

describe("deriveEmailIssueMetadata", () => {
	it("titles the issue with its subject and names the newsletter after its sender", () => {
		const metadata = deriveEmailIssueMetadata({ ...ISSUE, html: "<p>Hello</p>" });

		assert.deepEqual([metadata.title, metadata.siteName], ["Employee #1: Yahoo", "TLDR"]);
	});

	it("falls back to a placeholder title and the sender address when the email names neither", () => {
		const metadata = deriveEmailIssueMetadata({ subject: " ", senderEmail: "dan@tldr.tech", senderName: "", html: "<p>Hello</p>" });

		assert.deepEqual([metadata.title, metadata.siteName], ["(no subject)", "dan@tldr.tech"]);
	});

	it("reads the body as text, keeping words in separate blocks apart and dropping styles", () => {
		const metadata = deriveEmailIssueMetadata({
			...ISSUE,
			html: "<style>.x{color:red}</style><p>Tom &amp; Jerry &lt;3 caf&eacute;&nbsp;now</p><div>Next<br>line</div>",
		});

		assert.deepEqual([metadata.excerpt, metadata.wordCount], ["Tom & Jerry <3 café now Next line", 8]);
	});

	it("estimates the read time from the body's word count", () => {
		const metadata = deriveEmailIssueMetadata({ ...ISSUE, html: `<p>${"word ".repeat(600)}</p>` });

		assert.deepEqual([metadata.wordCount, metadata.estimatedReadTime], [600, 3]);
	});

	it("counts no words and reads in a minute when the body has no text", () => {
		const metadata = deriveEmailIssueMetadata({ ...ISSUE, html: "<img src=\"https://cdn.example/banner.png\">" });

		assert.deepEqual([metadata.excerpt, metadata.wordCount, metadata.estimatedReadTime], ["", 0, 1]);
	});

	it("cuts a long body at the last word that fits the excerpt", () => {
		const metadata = deriveEmailIssueMetadata({ ...ISSUE, html: `<p>${"abcdefghi ".repeat(30)}</p>` });

		assert.equal(metadata.excerpt, `${"abcdefghi ".repeat(24).trim()}…`);
	});

	it("cuts a body with no spaces at the excerpt length", () => {
		const metadata = deriveEmailIssueMetadata({ ...ISSUE, html: `<p>${"x".repeat(300)}</p>` });

		assert.equal(metadata.excerpt, `${"x".repeat(240)}…`);
	});
});
