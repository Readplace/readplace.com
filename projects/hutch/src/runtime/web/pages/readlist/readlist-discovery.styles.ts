import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DARK_ONLY_BODY_CLASS,
	LIGHT_ONLY_BODY_CLASS,
	SCRIM_BLUR,
	SCRIM_DARK,
	SCRIM_LIGHT,
} from "@packages/web-shell";

const stylesPath = join(__dirname, "readlist-discovery.styles.css");

const SCRIM_STYLES = `
.readlist-filters::backdrop {
	background: ${SCRIM_LIGHT};
	backdrop-filter: blur(${SCRIM_BLUR});
}

@media (prefers-color-scheme: dark) {
	body:not(.${LIGHT_ONLY_BODY_CLASS}) .readlist-filters::backdrop {
		background: ${SCRIM_DARK};
	}
}

body.${DARK_ONLY_BODY_CLASS} .readlist-filters::backdrop {
	background: ${SCRIM_DARK};
}
`;

export const READLIST_DISCOVERY_STYLES = `${readFileSync(stylesPath, "utf-8")}\n${SCRIM_STYLES}`;
