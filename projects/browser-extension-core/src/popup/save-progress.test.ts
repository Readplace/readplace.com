import assert from "node:assert/strict";
import { initSaveProgress } from "./save-progress";

describe("initSaveProgress", () => {
	it("maps the capturing phase to its width and label", () => {
		const progress = initSaveProgress();
		assert.equal(progress.widthFor("capturing"), "40%");
		assert.equal(progress.labelFor("capturing"), "Reading page…");
	});

	it("maps the uploading phase to its width and label", () => {
		const progress = initSaveProgress();
		assert.equal(progress.widthFor("uploading"), "75%");
		assert.equal(progress.labelFor("uploading"), "Saving…");
	});

	it("advances the width from capturing to uploading so the bar only moves forward", () => {
		const progress = initSaveProgress();
		assert.ok(
			Number.parseInt(progress.widthFor("uploading"), 10) >
				Number.parseInt(progress.widthFor("capturing"), 10),
			"uploading milestone should sit further along the bar than capturing",
		);
	});
});
