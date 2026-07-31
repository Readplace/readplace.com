import type { Message } from "../reading-list/reading-list.types";
import { buildSavedView } from "./saved-view";

function message(body: string, type: Message["type"] = "success"): Message {
	return { type, content: { type: "text/html", body } };
}

describe("buildSavedView", () => {
	it("sets the first line as the outcome and the rest as supporting text", () => {
		const lines = buildSavedView([
			message("Article saved"),
			message("Saved to your reading list"),
		]);

		expect(lines).toEqual([
			{ className: "saved-view__title", html: "Article saved" },
			{ className: "saved-view__subtitle", html: "Saved to your reading list" },
		]);
	});

	it("gives a lone message the outcome treatment, with nothing to support it", () => {
		expect(buildSavedView([message("Article saved")])).toEqual([
			{ className: "saved-view__title", html: "Article saved" },
		]);
	});

	it("keeps supporting a third line, so the server can say more without a new build", () => {
		const lines = buildSavedView([
			message("Article saved"),
			message("Saved to your reading list"),
			message("We will fetch the page shortly"),
		]);

		expect(lines.map((line) => line.className)).toEqual([
			"saved-view__title",
			"saved-view__subtitle",
			"saved-view__subtitle",
		]);
	});

	it("ignores a body in a media type it cannot render, rather than injecting it", () => {
		const lines = buildSavedView([
			{ type: "success", content: { type: "application/pdf", body: "%PDF-" } },
			message("Article saved"),
		]);

		expect(lines).toEqual([
			{ className: "saved-view__title", html: "Article saved" },
		]);
	});

	it("renders nothing when the server said nothing", () => {
		expect(buildSavedView([])).toEqual([]);
	});
});
