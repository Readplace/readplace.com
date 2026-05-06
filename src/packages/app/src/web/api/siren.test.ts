import { SIREN_MEDIA_TYPE, sirenError } from "./siren";

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
