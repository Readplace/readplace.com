import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IN_FLIGHT_DOTS_STYLES } from "../../shared/in-flight-dots/in-flight-dots.styles";

const stylesPath = join(__dirname, "gmail.styles.css");
export const GMAIL_PAGE_STYLES = IN_FLIGHT_DOTS_STYLES + readFileSync(stylesPath, "utf-8");
