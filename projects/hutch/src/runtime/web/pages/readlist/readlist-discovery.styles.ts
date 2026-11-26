import { readFileSync } from "node:fs";
import { join } from "node:path";

export const READLIST_DISCOVERY_STYLES = readFileSync(join(__dirname, "readlist-discovery.styles.css"), "utf-8");
