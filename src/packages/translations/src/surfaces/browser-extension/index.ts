import { defineSurface } from "../../define-surface";
import { enUS } from "./en-US";

export const browserExtension = defineSurface({
	purpose: "The Chrome and Firefox extension: popup, notifications, context menus and save-all-tabs",
	defaultMessages: enUS,
	otherLocales: {},
});
