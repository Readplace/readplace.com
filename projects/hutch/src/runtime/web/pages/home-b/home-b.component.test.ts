import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { HomePage } from "../home/home.component";
import { HomeVariantBPage } from "./home-b.component";

describe("homepage arm B treatment", () => {
	it.each([
		{ lastViewUrl: undefined, state: "due" },
		{ lastViewUrl: "https://www.example.com/essay/", state: "seen" },
		{ lastViewUrl: "invalid-url", state: "due" },
	] as const)("preserves the control outside the added section for $lastViewUrl", ({ lastViewUrl, state }) => {
		const input = { staticBaseUrl: "https://static.test", lastViewUrl, saveTip: { html: "", state } };
		const control = HomePage(input);
		const treatment = HomeVariantBPage(input);
		const controlDocument = parseHTML(control.content.html).document;
		const treatmentDocument = parseHTML(treatment.content.html).document;
		const sections = Array.from(treatmentDocument.querySelectorAll("[data-test-section]"));
		expect(sections.map((section) => section.getAttribute("data-test-section"))).toEqual([
			"hero", "ways-to-save", "assistant", "proof", "principle", "compare", "pricing", "faq", "close",
		]);
		for (const original of controlDocument.querySelectorAll("[data-test-section]")) {
			const key = original.getAttribute("data-test-section");
			const copy = treatmentDocument.querySelector(`[data-test-section="${key}"]`);
			assert(copy);
			original.classList.remove("home-band--muted");
			copy.classList.remove("home-band--muted");
			expect(copy.outerHTML).toBe(original.outerHTML);
		}
		expect(treatment.seo).toEqual(control.seo);
		expect(treatment.scripts).toEqual(control.scripts);
		expect(treatment.bodyClass).toBe("page-home");
	});
});
