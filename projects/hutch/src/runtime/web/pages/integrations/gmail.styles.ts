import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES, IN_FLIGHT_DOTS_STYLES } from "@packages/web-shell";

export const GMAIL_PAGE_STYLES = IN_FLIGHT_DOTS_STYLES
	+ ALERT_STYLES
	+ readFileSync(join(__dirname, "gmail.styles.css"), "utf-8")
	+ readFileSync(join(__dirname, "gmail-mappings.styles.css"), "utf-8");
