import assert from "node:assert/strict";
import { iconSvg } from "@packages/ui-icons";
import { parseHTML } from "linkedom";
import { ALERT_STYLES, renderAlert } from "./alert.component";

function alertElement(html: string): Element {
	const { document } = parseHTML(html);
	const element = document.querySelector("[data-test-alert]");
	assert(element, "renderAlert must render the alert slot");
	return element;
}

describe("renderAlert", () => {
	it.each([
		["error", "alert", "x-circle"],
		["warning", "status", "alert-triangle"],
		["success", "status", "check-circle"],
		["info", "status", "info"],
	] as const)("renders the %s variant with its role and glyph", (variant, role, icon) => {
		const element = alertElement(renderAlert({
			key: variant,
			content: { variant, title: { text: "A title", element: "p" } },
		}));

		expect(element.getAttribute("data-test-alert")).toBe(variant);
		expect(element.getAttribute("data-test-alert-variant")).toBe(variant);
		expect(element.classList.contains("alert--visible")).toBe(true);
		expect(element.classList.contains(`alert--${variant}`)).toBe(true);
		expect(element.getAttribute("role")).toBe(role);
		const drawing = element.querySelector(".alert__icon svg");
		assert(drawing, "visible alerts must draw an icon");
		expect(drawing.outerHTML).toContain('stroke-width="1.5"');
		expect(drawing.outerHTML).toContain('aria-hidden="true"');
		const expectedDrawing = parseHTML(iconSvg(icon)).document.querySelector("svg");
		assert(expectedDrawing, "the icon set must provide a drawing");
		expect(drawing.outerHTML).toBe(expectedDrawing.outerHTML);
	});

	it.each(["p", "h1", "h2"] as const)("renders a %s title at the shared title role", (elementName) => {
		const element = alertElement(renderAlert({
			key: "title",
			content: { variant: "error", title: { text: "Important", element: elementName } },
		}));
		const title = element.querySelector("[data-test-alert-title]");
		assert(title, "the title must render");
		expect(title.tagName.toLowerCase()).toBe(elementName);
		expect(title.classList.contains("alert__title")).toBe(true);
		expect(title.textContent).toBe("Important");
	});

	it("escapes a text message", () => {
		const element = alertElement(renderAlert({
			key: "text",
			content: { variant: "info", message: { text: "<strong>Safe</strong> & clear" } },
		}));
		const message = element.querySelector("[data-test-alert-message]");
		assert(message, "the message must render");
		expect(message.tagName.toLowerCase()).toBe("p");
		expect(message.textContent).toBe("<strong>Safe</strong> & clear");
	});

	it("inserts trusted rich message markup", () => {
		const element = alertElement(renderAlert({
			key: "rich",
			content: {
				variant: "error",
				title: { text: "A title", element: "h2" },
				message: { html: '<a href="/help">Read help</a>' },
			},
		}));
		const message = element.querySelector("[data-test-alert-message]");
		assert(message, "the message must render");
		expect(message.tagName.toLowerCase()).toBe("div");
		expect(message.querySelector("a")?.getAttribute("href")).toBe("/help");
		expect(message.textContent).toBe("Read help");
	});

	it("renders a hidden slot without live-region semantics or content", () => {
		const element = alertElement(renderAlert({ key: "empty", content: undefined }));
		expect(element.classList.contains("alert--hidden")).toBe(true);
		expect(element.getAttribute("data-test-alert")).toBe("empty");
		expect(element.getAttribute("role")).toBe(null);
		expect(element.children.length).toBe(0);
	});
});

describe("ALERT_STYLES", () => {
	it("declares both visibility states and each functional variant", () => {
		expect(ALERT_STYLES).toMatch(/\.alert--visible\s*\{\s*display:\s*flex;/);
		expect(ALERT_STYLES).toMatch(/\.alert--hidden\s*\{\s*display:\s*none;/);
		for (const variant of ["error", "warning", "success", "info"]) {
			expect(ALERT_STYLES).toContain(`.alert--${variant} {`);
		}
		expect(ALERT_STYLES).toContain("--alert-icon: var(--warning-text)");
	});
});
