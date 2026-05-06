import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "blog.styles.css");
export const BLOG_STYLES = readFileSync(stylesPath, "utf-8");
