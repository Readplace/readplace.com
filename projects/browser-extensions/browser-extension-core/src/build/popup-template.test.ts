import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconSvg } from "@packages/ui-icons";
import { renderIllustration } from "@packages/web-shell";
import { SYSTEM_THEME_VARIABLES } from "@packages/web-shell/design-system.styles";
import { renderPopupTemplate } from "./popup-template";

const shell = readFileSync(
	join(__dirname, "..", "..", "src", "popup", "popup.template.html"),
	"utf-8",
);

const template = readFileSync(
	join(__dirname, "..", "..", "src", "popup", "popup-views.template.html"),
	"utf-8",
);

describe("renderPopupTemplate", () => {
	it("tags the brand link home with the Chrome extension as its source", () => {
		expect(renderPopupTemplate({ template, utmSource: "chrome-extension" })).toContain(
			'<a href="https://readplace.com/?utm_source=chrome-extension&amp;utm_medium=extension&amp;utm_content=brand-home" class="login__logo-link" target="_blank" rel="noopener">',
		);
	});

	it("tags the readlist link with the Firefox extension as its source", () => {
		expect(renderPopupTemplate({ template, utmSource: "firefox-extension" })).toContain(
			'<a href="https://readplace.com/queue?queue=default&amp;utm_source=firefox-extension&amp;utm_medium=extension&amp;utm_content=open-readlist" class="list-view__brand" target="_blank" rel="noopener">',
		);
	});

	it("draws every icon from the shared set", () => {
		const rendered = renderPopupTemplate({ template, utmSource: "chrome-extension" });

		expect(rendered).toContain(`<div class="saved-view__icon" aria-hidden="true">${iconSvg("check")}</div>`);
		expect(rendered).toContain(`<span class="alert__icon" aria-hidden="true">${iconSvg("x-circle")}</span>`);
		expect(rendered).toContain(`<span class="alert__icon" aria-hidden="true">${iconSvg("alert-triangle")}</span>`);
		expect(rendered).toContain(`<span class="list-view__search-icon" aria-hidden="true">${iconSvg("search")}</span>`);
	});

	it("illustrates the empty list with the shared art", () => {
		expect(renderPopupTemplate({ template, utmSource: "chrome-extension" })).toContain(
			`<span class="list-view__empty-art" aria-hidden="true">${renderIllustration("book-lightbulb")}</span>`,
		);
	});

	it("labels the sign-out control in words rather than an icon", () => {
		expect(renderPopupTemplate({ template, utmSource: "chrome-extension" })).toContain(
			'<button id="logout-button" class="btn btn--neutral btn--s" type="button">Sign out</button>',
		);
	});

	it.each(["chrome-extension", "firefox-extension"] as const)("labels the %s filter in visible text tied to its field", (utmSource) => {
		const rendered = renderPopupTemplate({ template, utmSource });

		expect(rendered).toContain(
			'<label for="filter-input" class="list-view__search-label">Filter this readlist page by title or web address</label>',
		);
		expect(rendered).toContain('id="filter-input"');
	});

	it.each(["chrome-extension", "firefox-extension"] as const)("scopes the %s zero-match message to the page in hand", (utmSource) => {
		expect(renderPopupTemplate({ template, utmSource })).toContain(
			'<p id="no-matches" class="list-empty__title list-view__no-matches" role="status" data-message="No matches on this page"></p>',
		);
	});

	it("leaves no placeholder unfilled", () => {
		expect(renderPopupTemplate({ template, utmSource: "firefox-extension" })).not.toContain("{{");
	});

	it("gives the first-paint shell the theme tokens before any stylesheet loads", () => {
		const rendered = renderPopupTemplate({ template: shell, utmSource: "chrome-extension" });

		expect(rendered).toContain(SYSTEM_THEME_VARIABLES);
		expect(rendered).not.toContain("{{");
	});

	it("refuses a template that names a placeholder it cannot fill", () => {
		expect(() => renderPopupTemplate({ template: "<p>{{unknown}}</p>", utmSource: "chrome-extension" })).toThrow(
			"the popup template names a placeholder the build does not fill",
		);
	});
});
