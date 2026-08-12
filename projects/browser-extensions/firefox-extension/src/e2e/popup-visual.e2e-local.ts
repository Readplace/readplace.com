import path from "node:path";
import { registerPopupVisualSuite } from "browser-extension-core/popup-visual";

registerPopupVisualSuite({
	packagedPopup: path.resolve(
		__dirname,
		"..",
		"..",
		"dist-extension-compiled",
		"popup",
		"popup.template.html",
	),
});
