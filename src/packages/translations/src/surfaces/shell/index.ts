import { defineSurface } from "../../define-surface";
import { enUS } from "./en-US";

export const shell = defineSurface({
	purpose: "The web shell every Readplace site renders around its pages: navigation, footer, banners, toast, confirm popover, offline indicator, pagination, the account-locked page, pricing and local-time words",
	defaultMessages: enUS,
	otherLocales: {},
});
