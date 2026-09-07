import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "subscribe-plans.styles.css");
export const SUBSCRIBE_PLANS_STYLES = readFileSync(stylesPath, "utf-8");
