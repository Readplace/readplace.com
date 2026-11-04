import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { HomeVariantBPage } from "../home-b";
import { HomeVariantCPage } from "./home-c.component";

describe("homepage arm C treatment", () => {
	it.each([
		{ lastViewUrl: undefined, state: "due" },
		{ lastViewUrl: "https://www.example.com/essay/", state: "seen" },
		{ lastViewUrl: "invalid-url", state: "due" },
	] as const)("differs from arm B only by its hero, its capabilities and arm B's comparison for $lastViewUrl", ({ lastViewUrl, state }) => {
		const input = { staticBaseUrl: "https://static.test", lastViewUrl, saveTip: { html: "", state } };
		const armB = HomeVariantBPage(input);
		const treatment = HomeVariantCPage(input);
		const armBDocument = parseHTML(armB.content.html).document;
		const treatmentDocument = parseHTML(treatment.content.html).document;
		const sections = Array.from(treatmentDocument.querySelectorAll("[data-test-section]"));
		expect(sections.map((section) => section.getAttribute("data-test-section"))).toEqual([
			"hero", "ways-to-save", "assistant", "proof", "capabilities", "principle", "pricing", "faq", "close",
		]);
		for (const key of ["ways-to-save", "assistant", "proof", "principle", "pricing", "faq", "close"]) {
			const original = armBDocument.querySelector(`[data-test-section="${key}"]`);
			const copy = treatmentDocument.querySelector(`[data-test-section="${key}"]`);
			assert(original && copy, `both arms must render the ${key} section`);
			original.classList.remove("home-band--muted");
			copy.classList.remove("home-band--muted");
			expect(copy.outerHTML).toBe(original.outerHTML);
		}
		expect(treatment.seo).toEqual(armB.seo);
		expect(treatment.scripts).toEqual(armB.scripts);
		expect(treatment.bodyClass).toBe("page-home");
	});
});
