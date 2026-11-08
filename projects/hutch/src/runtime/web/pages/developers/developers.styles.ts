import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNDERLINE_TABS_STYLES } from "@packages/web-shell";
import { DISCLOSURE_CARD_STYLES } from "../../shared/disclosure-card/disclosure-card.styles";

const stylesPath = join(__dirname, "developers.styles.css");
export const DEVELOPERS_STYLES = `${UNDERLINE_TABS_STYLES}\n${DISCLOSURE_CARD_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
