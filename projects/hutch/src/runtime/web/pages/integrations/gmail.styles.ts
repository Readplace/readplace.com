import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES, CONFIRM_POPOVER_STYLES, IN_FLIGHT_DOTS_STYLES } from "@packages/web-shell";
import { READLIST_FILTER_STYLES } from "../../shared/readlist-filter/readlist-filter.styles";

export const GMAIL_SENDER_WIDGET_STYLES = IN_FLIGHT_DOTS_STYLES
	+ ALERT_STYLES
	+ READLIST_FILTER_STYLES
	+ readFileSync(join(__dirname, "gmail.styles.css"), "utf-8");

export const GMAIL_PAGE_STYLES = CONFIRM_POPOVER_STYLES
	+ GMAIL_SENDER_WIDGET_STYLES
	+ readFileSync(join(__dirname, "gmail-mappings.styles.css"), "utf-8")
	+ readFileSync(join(__dirname, "gmail-dialog.styles.css"), "utf-8");
