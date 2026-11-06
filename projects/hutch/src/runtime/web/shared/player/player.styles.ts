import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PLAYER_STYLES = readFileSync(join(__dirname, "player.styles.css"), "utf-8");
