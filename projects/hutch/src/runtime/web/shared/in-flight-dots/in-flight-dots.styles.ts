import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "in-flight-dots.styles.css");

export const IN_FLIGHT_DOTS_STYLES = readFileSync(stylesPath, "utf-8");
