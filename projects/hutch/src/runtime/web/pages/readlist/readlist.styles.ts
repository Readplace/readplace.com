import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ALERT_STYLES,
	IN_FLIGHT_DOTS_STYLES,
	MENU_STYLES,
	PAGINATION_STYLES,
	UNDERLINE_TABS_STYLES,
} from "@packages/web-shell";
import { READLIST_ROW_STYLES } from "../../shared/readlist-row/readlist-row.styles";
import { READLIST_NAME_FORM_STYLES } from "./readlist-name-form.styles";

const stylesPath = join(__dirname, "readlist.styles.css");
export const READLIST_STYLES = `${UNDERLINE_TABS_STYLES}\n${IN_FLIGHT_DOTS_STYLES}\n${MENU_STYLES}\n${PAGINATION_STYLES}\n${ALERT_STYLES}\n${READLIST_ROW_STYLES}\n${READLIST_NAME_FORM_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
