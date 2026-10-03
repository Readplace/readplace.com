import assert from "node:assert/strict";
import { iconSvg } from "@packages/ui-icons";
import { JSDOM } from "jsdom";
import { GlobalNav, type NavProps } from "./nav.component";

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function shapesOf(svg: Element | null): string[] {
	assert(svg, "an icon must be drawn");
	return Array.from(svg.querySelectorAll("path, circle, rect")).map((shape) => shape.outerHTML);
}

function currentItemKeys(html: string): (string | null)[] {
	return Array.from(parse(html).querySelectorAll('[aria-current="page"]')).map((el) =>
		el.getAttribute("data-test-nav-item"),
	);
}

const SIGNED_IN: NavProps = {
	variant: "default",
	isAuthenticated: true,
	accessIsReadOnly: false,
	gmailFeatureEnabled: true,
};

const GUEST: NavProps = {
	variant: "default",
	isAuthenticated: false,
	accessIsReadOnly: false,
	gmailFeatureEnabled: false,
};

describe("GlobalNav component", () => {
	it("renders authenticated nav items (queue, import, inbox, account, blog, sign out) for an authenticated full-access user", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
		assert(doc.querySelector('[data-test-nav-item="queue"]'));
		assert(doc.querySelector('[data-test-nav-item="import"]'));
		assert(doc.querySelector('[data-test-nav-item="inbox"]'));
		assert(doc.querySelector('[data-test-nav-item="logout"]'));
		assert(doc.querySelector('[data-test-nav-item="blog"]'));
		const account = doc.querySelector('[data-test-nav-item="account"]');
		assert(account, "account nav item must render for authenticated full-access users");
		const form = account.closest("form");
		assert(form, "account nav item must be inside a form");
		expect(form.getAttribute("action")).toBe("/account?utm_source=header-nav&utm_medium=internal&utm_content=account");
	});

	it("splits the authenticated nav into a Library section (queue, import, inbox) and an Account section (account, blog, privacy, terms, sign out)", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const groups = Array.from(doc.querySelectorAll("[data-test-nav-group]")).map(
			(el) => el.getAttribute("data-test-nav-group"),
		);
		expect(groups).toEqual(["library", "account"]);

		const library = doc.querySelector('[data-test-nav-group="library"]');
		assert(library, "library group must render");
		expect(library.querySelector(".nav__group-label")?.textContent).toBe("Library");
		const libraryItems = Array.from(
			library.querySelectorAll("[data-test-nav-item]"),
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(libraryItems).toEqual(["queue", "import", "inbox"]);

		const account = doc.querySelector('[data-test-nav-group="account"]');
		assert(account, "account group must render");
		const accountItems = Array.from(
			account.querySelectorAll("[data-test-nav-item]"),
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(accountItems).toEqual(["account", "blog", "privacy", "terms", "logout"]);
	});

	it("folds the Account section into a user menu carrying the signed-in email and its initials", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				userEmail: "james.davis@example.com",
			}),
		);

		const account = doc.querySelector('[data-test-nav-group="account"]');
		assert(account, "account group must render");
		const menu = account.querySelector("[data-test-nav-user]");
		assert(menu, "the account group must render as a user menu when the email is known");
		expect(menu.tagName.toLowerCase()).toBe("details");
		expect(menu.hasAttribute("open")).toBe(false);
		expect(menu.querySelector(".nav__avatar")?.textContent).toBe("JD");
		expect(menu.querySelector("[data-test-nav-user-email]")?.textContent).toBe("james.davis@example.com");
		expect(menu.querySelector("summary")?.getAttribute("aria-label")).toBe(
			"Account menu for james.davis@example.com",
		);
		const accountItems = Array.from(menu.querySelectorAll("[data-test-nav-item]")).map((el) =>
			el.getAttribute("data-test-nav-item"),
		);
		expect(accountItems).toEqual(["account", "blog", "privacy", "terms", "logout"]);
		const library = doc.querySelector('[data-test-nav-group="library"]');
		assert(library, "library group must render");
		expect(library.querySelector(".nav__group-label")?.textContent).toBe("Library");
		expect(library.firstElementChild?.className).toBe("nav__group-label");
	});

	it("still folds a signed-in Account section into a user menu when the email is unknown, behind a plain Account trigger", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const account = doc.querySelector('[data-test-nav-group="account"]');
		assert(account, "account group must render");
		const menu = account.querySelector("[data-test-nav-user]");
		assert(menu, "a signed-in account group must render as a user menu even without an email");
		expect(menu.querySelector(".nav__avatar")?.textContent).toBe("");
		expect(menu.querySelector("[data-test-nav-user-email]")?.textContent).toBe("Account");
		expect(menu.querySelector("summary")?.getAttribute("aria-label")).toBe("Account menu");
		const accountItems = Array.from(menu.querySelectorAll("[data-test-nav-item]")).map((el) =>
			el.getAttribute("data-test-nav-item"),
		);
		expect(accountItems).toEqual(["account", "blog", "privacy", "terms", "logout"]);
	});

	it("keeps the library icons distinct: a solid book for the current readlist, a stroke file for imports, a stroke tray for the inbox", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
				currentPath: "/queue",
			}),
		);

		const drawn = [
			["queue", iconSvg("book", { variant: "solid" })],
			["import", iconSvg("file-down")],
			["inbox", iconSvg("inbox")],
		] as const;
		for (const [key, svg] of drawn) {
			expect(shapesOf(doc.querySelector(`[data-test-nav-item="${key}"] .nav__icon svg`))).toEqual(
				shapesOf(parse(svg).querySelector("svg")),
			);
		}
	});

	it("renders the Inbox entry for every full-access user", () => {
		const doc = parse(GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		}));

		const libraryItems = Array.from(
			doc
				.querySelector('[data-test-nav-group="library"]')
				?.querySelectorAll("[data-test-nav-item]") ?? [],
		).map((el) => el.getAttribute("data-test-nav-item"));
		expect(libraryItems).toEqual(["queue", "import", "inbox"]);
	});

	it("submits the Inbox entry as a plain GET form", () => {
		const doc = parse(GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		}));

		const inboxForm = doc.querySelector('[data-test-nav-item="inbox"]')?.closest("form");
		assert(inboxForm, "inbox nav item must be inside a form");
		expect(inboxForm.getAttribute("method")).toBe("GET");
		const hiddenInputNames = Array.from(
			inboxForm.querySelectorAll('input[type="hidden"]'),
		).map((el) => el.getAttribute("name"));
		expect(hiddenInputNames).toEqual(["utm_source", "utm_medium", "utm_content"]);
	});

	it("keeps the icon out of each item's accessible name, leaving the label alone", () => {
		const doc = parse(
			GlobalNav({
				variant: "default",
				isAuthenticated: true,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const queue = doc.querySelector('[data-test-nav-item="queue"]');
		assert(queue, "queue nav item must render");
		expect(queue.textContent).toBe("Readlist");
	});

	it("renders guests through the same groups: Install, Import Links and Features in Library, and Log in alone in Account", () => {
		const doc = parse(GlobalNav(GUEST));

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav variant marker must render");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");

		const itemsByGroup = Array.from(doc.querySelectorAll("[data-test-nav-group]")).map((group) => [
			group.getAttribute("data-test-nav-group"),
			Array.from(group.querySelectorAll("[data-test-nav-item]")).map((el) => el.getAttribute("data-test-nav-item")),
		]);
		expect(itemsByGroup).toEqual([
			["library", ["install", "import", "features"]],
			["account", ["login"]],
		]);

		const install = doc.querySelector('[data-test-nav-item="install"]');
		assert(install, "guest nav must render an install item");
		expect(install.closest("form")?.getAttribute("action")).toBe("/install?utm_source=header-nav&utm_medium=internal&utm_content=install");
	});

	it("renders guest Log in as a primary M button with its log-in glyph, and every other item as a plain nav link", () => {
		const doc = parse(GlobalNav(GUEST));

		const classes = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) => [
			el.getAttribute("data-test-nav-item"),
			el.getAttribute("class"),
		]);
		expect(classes).toEqual([
			["install", "nav__link"],
			["import", "nav__link"],
			["features", "nav__link"],
			["login", "nav__link btn btn--primary btn--m"],
		]);
		expect(shapesOf(doc.querySelector('[data-test-nav-item="login"] .nav__icon svg'))).toEqual(
			shapesOf(parse(iconSvg("log-in")).querySelector("svg")),
		);
	});

	describe("marks the destination the page belongs to as the current item", () => {
		it.each([
			["/queue", "queue"],
			["/queue?filter=unread", "queue"],
			["/queue/abc123/view", "queue"],
			["/queues/rl-1?order=asc", "queue"],
			["/view/example.com/an-article", "queue"],
			["/view?url=https%3A%2F%2Fexample.com", "queue"],
			["/import", "import"],
			["/import/imp-1/review?page=2", "import"],
			["/inbox", "inbox"],
			["/inbox/emails/msg-1", "inbox"],
			["/newsletters", "integrations"],
			["/newsletters/gmail?feature=gmail", "integrations"],
			["/newsletters/custom-emails", "integrations"],
		])("marks %s as the %s item for a signed-in reader", (currentPath, key) => {
			expect(currentItemKeys(GlobalNav({ ...SIGNED_IN, currentPath }))).toEqual([key]);
		});

		it.each([
			["/install", "install"],
			["/install?client=firefox", "install"],
			["/import", "import"],
		])("marks %s as the %s item for a guest", (currentPath, key) => {
			expect(currentItemKeys(GlobalNav({ ...GUEST, currentPath }))).toEqual([key]);
		});

		it.each([
			"/account",
			"/oauth/authorize?client_id=readplace-ios",
			"/",
			"/blog/changelog",
			"/login",
			"/export",
			"/queued",
			"/view-source",
			"/install",
			"//[::1",
			"//%zz[/queue",
		])("marks no signed-in item current on %s", (currentPath) => {
			expect(currentItemKeys(GlobalNav({ ...SIGNED_IN, currentPath }))).toEqual([]);
		});

		it("marks no guest item current on a readlist path, which has no guest destination", () => {
			expect(currentItemKeys(GlobalNav({ ...GUEST, currentPath: "/view/example.com/an-article" }))).toEqual([]);
		});

		it("marks no item current when the site supplies no request path", () => {
			expect(currentItemKeys(GlobalNav(SIGNED_IN))).toEqual([]);
		});

		it("puts aria-current on the current item alone, leaving the other items without the attribute", () => {
			const doc = parse(GlobalNav({ ...SIGNED_IN, currentPath: "/import" }));

			const ariaCurrent = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) => [
				el.getAttribute("data-test-nav-item"),
				el.getAttribute("aria-current"),
			]);
			expect(ariaCurrent).toEqual([
				["queue", null],
				["import", "page"],
				["inbox", null],
				["integrations", null],
				["account", null],
				["blog", null],
				["privacy", null],
				["terms", null],
				["logout", null],
			]);
		});

		it("draws the current item with its solid glyph and the rest with their stroke glyphs", () => {
			const doc = parse(GlobalNav({ ...SIGNED_IN, currentPath: "/inbox" }));

			const drawn = [
				["queue", iconSvg("book")],
				["import", iconSvg("file-down")],
				["inbox", iconSvg("inbox", { variant: "solid" })],
				["integrations", iconSvg("plug")],
			] as const;
			for (const [key, svg] of drawn) {
				expect(shapesOf(doc.querySelector(`[data-test-nav-item="${key}"] .nav__icon svg`))).toEqual(
					shapesOf(parse(svg).querySelector("svg")),
				);
			}
		});

		it("keeps the stroke glyph on a current item that has no solid drawing, so the ink step alone marks it", () => {
			const integrations = parse(GlobalNav({ ...SIGNED_IN, currentPath: "/newsletters" }));
			const install = parse(GlobalNav({ ...GUEST, currentPath: "/install" }));

			expect(shapesOf(integrations.querySelector('[data-test-nav-item="integrations"] .nav__icon svg'))).toEqual(
				shapesOf(parse(iconSvg("plug")).querySelector("svg")),
			);
			expect(shapesOf(install.querySelector('[data-test-nav-item="install"] .nav__icon svg'))).toEqual(
				shapesOf(parse(iconSvg("download")).querySelector("svg")),
			);
		});
	});

	it("applies the transparent header modifier when variant is 'transparent'", () => {
		const doc = parse(
			GlobalNav({
				variant: "transparent",
				isAuthenticated: false,
				accessIsReadOnly: false,
				gmailFeatureEnabled: false,
			}),
		);

		const header = doc.querySelector(".header");
		assert(header, "header element must render");
		expect(header.classList.contains("header--transparent")).toBe(true);
	});

	it("renders the menu glyph and the close cross together, so the open state alone flips the toggle", () => {
		const html = GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		});

		const toggle = parse(html).querySelector(".nav__toggle");
		assert(toggle, "nav toggle must render");
		expect(toggle.tagName.toLowerCase()).toBe("summary");
		expect(html).toContain(`<span class="nav__toggle-icon nav__toggle-icon--open">${iconSvg("menu")}</span>`);
		expect(html).toContain(`<span class="nav__toggle-icon nav__toggle-icon--close">${iconSvg("x")}</span>`);
	});

	it("hangs the menu off a closed disclosure, so the bar opens it with no script", () => {
		const html = GlobalNav({
			variant: "default",
			isAuthenticated: true,
			accessIsReadOnly: false,
			gmailFeatureEnabled: false,
		});

		const disclosure = parse(html).querySelector(".nav__disclosure");
		assert(disclosure, "nav disclosure must render");
		expect(disclosure.hasAttribute("open")).toBe(false);
		expect(disclosure.querySelector("#nav-menu")?.className).toBe("nav__menu");
	});

	describe("clickSurface marks which page rendered the shared chrome", () => {
		it("stamps utm_term on the brand link so a logo click is attributable to the reader view", () => {
			const doc = parse(
				GlobalNav({
					variant: "default",
					isAuthenticated: false,
					accessIsReadOnly: false,
					gmailFeatureEnabled: false,
					clickSurface: "reader-public",
				}),
			);

			const brand = doc.querySelector(".header__brand");
			assert(brand, "brand link must render");
			const href = new URL(brand.getAttribute("href") ?? "", "https://internal.invalid");
			expect(href.searchParams.get("utm_content")).toBe("brand");
			expect(href.searchParams.get("utm_term")).toBe("reader-public");
		});

		it("adds a utm_term hidden input to each guest nav GET form so a submit carries the surface", () => {
			const doc = parse(
				GlobalNav({
					variant: "default",
					isAuthenticated: false,
					accessIsReadOnly: false,
					gmailFeatureEnabled: false,
					clickSurface: "reader-public",
				}),
			);

			const install = doc.querySelector('[data-test-nav-item="install"]')?.closest("form");
			assert(install, "install nav item must be inside a form");
			const hiddenInputNames = Array.from(install.querySelectorAll('input[type="hidden"]')).map((el) =>
				el.getAttribute("name"),
			);
			expect(hiddenInputNames).toEqual(["utm_source", "utm_medium", "utm_content", "utm_term"]);
			expect(install.querySelector('input[name="utm_term"]')?.getAttribute("value")).toBe("reader-public");
		});

		it("adds the utm_term hidden input to authenticated nav forms too", () => {
			const doc = parse(
				GlobalNav({
					variant: "default",
					isAuthenticated: true,
					accessIsReadOnly: false,
					gmailFeatureEnabled: false,
					clickSurface: "reader-public",
				}),
			);

			const queue = doc.querySelector('[data-test-nav-item="queue"]')?.closest("form");
			assert(queue, "queue nav item must be inside a form");
			expect(queue.querySelector('input[name="utm_term"]')?.getAttribute("value")).toBe("reader-public");
		});

		it("carries the surface into the logout POST action, whose fields ride the request body not the query", () => {
			const doc = parse(
				GlobalNav({
					variant: "default",
					isAuthenticated: true,
					accessIsReadOnly: false,
					gmailFeatureEnabled: false,
					clickSurface: "reader-public",
				}),
			);

			const logout = doc.querySelector('[data-test-nav-item="logout"]')?.closest("form");
			assert(logout, "logout nav item must be inside a form");
			expect(logout.getAttribute("method")).toBe("POST");
			const action = new URL(logout.getAttribute("action") ?? "", "https://internal.invalid");
			expect(action.searchParams.get("utm_content")).toBe("logout");
			expect(action.searchParams.get("utm_term")).toBe("reader-public");
		});
	});
});
