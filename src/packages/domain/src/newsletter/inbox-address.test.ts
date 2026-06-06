import { NewsletterInboxTokenSchema } from "./newsletter.schema";
import { buildInboxAddress, findInboxToken, parseInboxToken } from "./inbox-address";

const TOKEN = NewsletterInboxTokenSchema.parse("0123456789abcdef01234567");
const DOMAIN = "inbox.readplace.com";

describe("buildInboxAddress", () => {
	it("joins the token and domain into an address", () => {
		expect(buildInboxAddress({ token: TOKEN, domain: DOMAIN })).toBe(
			"0123456789abcdef01234567@inbox.readplace.com",
		);
	});
});

describe("parseInboxToken", () => {
	it("extracts the token from a bare address", () => {
		expect(parseInboxToken({ recipient: `${TOKEN}@${DOMAIN}`, domain: DOMAIN })).toBe(TOKEN);
	});

	it("extracts the token from a display-name address with angle brackets", () => {
		expect(
			parseInboxToken({ recipient: `Reader <${TOKEN}@${DOMAIN}>`, domain: DOMAIN }),
		).toBe(TOKEN);
	});

	it("matches the domain case-insensitively", () => {
		expect(
			parseInboxToken({ recipient: `${TOKEN}@INBOX.Readplace.com`, domain: DOMAIN }),
		).toBe(TOKEN);
	});

	it("returns null when the recipient has no @", () => {
		expect(parseInboxToken({ recipient: "not-an-email", domain: DOMAIN })).toBeNull();
	});

	it("returns null when the domain does not match", () => {
		expect(
			parseInboxToken({ recipient: `${TOKEN}@other.example.com`, domain: DOMAIN }),
		).toBeNull();
	});

	it("returns null when the local-part is not a valid token", () => {
		expect(parseInboxToken({ recipient: `hello@${DOMAIN}`, domain: DOMAIN })).toBeNull();
	});
});

describe("findInboxToken", () => {
	it("returns the first recipient that resolves to a token", () => {
		const token = findInboxToken({
			recipients: ["team@example.com", `${TOKEN}@${DOMAIN}`],
			domain: DOMAIN,
		});
		expect(token).toBe(TOKEN);
	});

	it("returns null when no recipient is an inbox address", () => {
		expect(
			findInboxToken({ recipients: ["a@example.com", "b@example.com"], domain: DOMAIN }),
		).toBeNull();
	});
});
