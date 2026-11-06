import { ALL_SURFACES } from "./all-surfaces";
import { combineSurfaces } from "./define-surface";

const {
	"hutch-api": _hutchApi,
	"hutch-stored": _hutchStored,
	"browser-extension": _browserExtension,
	...WEB_SURFACES
} = ALL_SURFACES;

export const WEB_CATALOG = combineSurfaces(WEB_SURFACES);

export const WEB_SURFACE_NAMES = Object.keys(WEB_SURFACES);
