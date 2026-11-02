import { ALL_SURFACES } from "./all-surfaces";
import { combineSurfaces } from "./define-surface";

const NOT_WEB_SURFACES = new Set(["hutch-api", "hutch-stored", "browser-extension"]);

export const WEB_CATALOG = combineSurfaces(
	Object.fromEntries(Object.entries(ALL_SURFACES).filter(([name]) => !NOT_WEB_SURFACES.has(name))),
);
