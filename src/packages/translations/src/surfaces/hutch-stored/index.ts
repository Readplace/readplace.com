import { defineSurface } from "../../define-surface";
import { enUS } from "./en-US";

export const hutchStored = defineSurface({
	purpose: "Sentences written to storage at the storage locale and read back later: Gmail discovery failure messages, article host stubs and the starter readlist label",
	defaultMessages: enUS,
	otherLocales: {},
});
