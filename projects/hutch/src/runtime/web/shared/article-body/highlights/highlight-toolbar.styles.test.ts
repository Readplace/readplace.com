import { iconSvg } from "@packages/ui-icons";
import { HIGHLIGHT_TOOLBAR_STYLES } from "./highlight-toolbar.styles";

describe("HIGHLIGHT_TOOLBAR_STYLES", () => {
	it("gives a highlight's note end the shared note drawing as its glyph", () => {
		expect(HIGHLIGHT_TOOLBAR_STYLES).toContain(
			`.article-highlight--note-end{--article-highlight-note-glyph:url("data:image/svg+xml,${encodeURIComponent(iconSvg("note"))}")}`,
		);
	});
});
