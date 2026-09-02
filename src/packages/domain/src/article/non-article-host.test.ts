import { isNonArticleHost } from "./non-article-host";

const EVERY_LISTED_HOST = [
	"mail.google.com",
	"outlook.live.com",
	"outlook.office.com",
	"outlook.office365.com",
	"mail.yahoo.com",
	"mail.proton.me",
	"app.fastmail.com",
	"mail.zoho.com",
	"mail.aol.com",
	"mail.yandex.com",
	"mail.gmx.com",
	"mail.gmx.net",
	"app.hey.com",
	"mail.superhuman.com",
	"app.tuta.com",
	"mail.qq.com",
	"mail.163.com",
];

describe("isNonArticleHost", () => {
	it.each(EVERY_LISTED_HOST)("matches the listed host %s", (host) => {
		expect(isNonArticleHost(`https://${host}/mail/u/0/`)).toBe(true);
	});

	it("matches a subdomain of a listed host", () => {
		expect(isNonArticleHost("https://eu.mail.proton.me/u/0/inbox")).toBe(true);
	});

	it("matches regardless of hostname case", () => {
		expect(isNonArticleHost("https://MAIL.GOOGLE.COM/mail/u/0/")).toBe(true);
	});

	it("matches a fully-qualified hostname written with a trailing dot", () => {
		expect(isNonArticleHost("https://mail.google.com./mail/u/0/")).toBe(true);
	});

	it("does not match a host that merely ends with a listed host's own label", () => {
		expect(isNonArticleHost("https://notmail.google.com/post")).toBe(false);
	});

	it("does not match an attacker host that carries a listed host as a prefix", () => {
		expect(isNonArticleHost("https://mail.google.com.evil.example/post")).toBe(false);
	});

	it("does not match an ordinary publisher", () => {
		expect(isNonArticleHost("https://example.com/post")).toBe(false);
	});

	it("does not match a value that is not a URL", () => {
		expect(isNonArticleHost("mail.google.com")).toBe(false);
	});
});
