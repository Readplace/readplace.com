import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_FILTER_STYLES } from "../readlist-filter/readlist-filter.styles";

const stylesPath = join(__dirname, "article-frame.styles.css");

export const ARTICLE_FRAME_STYLES = `${READLIST_FILTER_STYLES}\n${readFileSync(stylesPath, "utf-8")}`;
