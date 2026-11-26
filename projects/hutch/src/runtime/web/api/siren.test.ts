import { SIREN_MEDIA_TYPE, sirenError, sirenWarning } from "./siren";

describe("SIREN_MEDIA_TYPE", () => {
	it("equals the standard Siren media type", () => {
		expect(SIREN_MEDIA_TYPE).toBe("application/vnd.siren+json");
	});
});

describe("sirenError", () => {
	it("returns an error entity with the provided code and message", () => {
		const entity = sirenError({ code: "not-found", message: "Article not found" });

		expect(entity).toEqual({
			class: ["error"],
			properties: { code: "not-found", message: "Article not found" },
		});
	});
});

describe("sirenWarning", () => {
	it("wraps an HTML body in a warning message", () => {
		expect(sirenWarning("<b>Heads up</b>")).toEqual({
			type: "warning",
			content: { type: "text/html", body: "<b>Heads up</b>" },
		});
	});
});
