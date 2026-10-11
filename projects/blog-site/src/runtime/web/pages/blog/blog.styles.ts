import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TLDR_DISCLOSURE_STYLES } from "@packages/web-shell";

const stylesPath = join(__dirname, "blog.styles.css");
export const BLOG_STYLES = TLDR_DISCLOSURE_STYLES + readFileSync(stylesPath, "utf-8");
