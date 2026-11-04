import { initPopup } from "browser-extension-core";
import { Logger, consoleLogger } from "@packages/logger";

declare const __APP_DOMAINS__: string[];
declare const __POPUP_VIEWS__: string;

initPopup({
	browser,
	appDomains: __APP_DOMAINS__,
	logger: Logger.from(consoleLogger),
	views: __POPUP_VIEWS__,
});
