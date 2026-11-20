import { readFileSync } from "node:fs";
import { join } from "node:path";

export const NEWSLETTER_LINKS_STYLES = readFileSync(
	join(__dirname, "newsletter-links.styles.css"),
	"utf-8",
);
