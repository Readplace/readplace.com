import { defineSurface } from "../../define-surface";
import { enUS } from "./en-US";

export const hutchApi = defineSurface({
	purpose: "The Siren API clients render: action and link titles, message bodies and API error messages; a client skips an action with no title, so none may be empty",
	nonEmpty: true,
	defaultMessages: enUS,
	otherLocales: {},
});
