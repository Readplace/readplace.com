import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES } from "@packages/web-shell";

export const NEWSLETTER_LINKS_STYLES =
	ALERT_STYLES + readFileSync(join(__dirname, "newsletter-links.styles.css"), "utf-8");
