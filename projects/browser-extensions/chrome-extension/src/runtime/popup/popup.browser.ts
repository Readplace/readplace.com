import browser from "webextension-polyfill";
import { initPopup } from "browser-extension-core";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";

declare const __APP_DOMAINS__: string[];
declare const __POPUP_VIEWS__: string;

initPopup({
	browser,
	appDomains: __APP_DOMAINS__,
	logger: HutchLogger.from(consoleLogger),
	views: __POPUP_VIEWS__,
});
