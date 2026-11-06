import { defineSurface } from "../../define-surface";
import { enUS } from "./en-US";

export const hutchAuth = defineSurface({
	purpose: "Readplace sign-in: login, signup, password reset and change, OAuth consent, onboarding and the messages the auth middleware shows",
	defaultMessages: enUS,
	otherLocales: {},
});
