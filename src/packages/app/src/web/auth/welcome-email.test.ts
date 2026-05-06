import { buildWelcomeEmailHtml } from "./welcome-email";

describe("buildWelcomeEmailHtml", () => {
	it("includes the install URL in the call-to-action link", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain('href="https://readplace.com/install"');
	});

	it("escapes HTML entities in the install URL to prevent injection", () => {
		const html = buildWelcomeEmailHtml({
			installUrl: 'https://example.com/install?a=1&b=2"<>',
			avatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		});

		expect(html).toContain('href="https://example.com/install?a&#x3D;1&amp;b&#x3D;2&quot;&lt;&gt;"');
	});

	it("renders the avatar image at the top of the body", () => {
		const html = buildWelcomeEmailHtml({
			installUrl: "https://readplace.com/install",
			avatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		});

		expect(html).toContain('src="https://static.readplace.com/fayner-brack.jpg"');
		expect(html).toContain('alt="Fayner Brack"');
	});

	it("escapes HTML entities in the avatar URL to prevent injection", () => {
		const html = buildWelcomeEmailHtml({
			installUrl: "https://readplace.com/install",
			avatarUrl: 'https://example.com/avatar.jpg?a=1&b=2"<>',
		});

		expect(html).toContain('src="https://example.com/avatar.jpg?a&#x3D;1&amp;b&#x3D;2&quot;&lt;&gt;"');
	});

	it("renders the welcome heading", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("Welcome to Readplace");
	});

	it("invites the recipient to reply directly with feedback", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("reply to this email");
	});

	it("produces a complete HTML document", () => {
		const html = buildWelcomeEmailHtml({ installUrl: "https://readplace.com/install", avatarUrl: "https://static.readplace.com/fayner-brack.jpg" });

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("</html>");
	});
});
