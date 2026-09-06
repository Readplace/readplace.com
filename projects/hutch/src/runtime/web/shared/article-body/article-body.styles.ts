import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTICLE_FRAME_STYLES } from "./article-frame.styles";

const stylesPath = join(__dirname, "article-body.styles.css");
const crawlBookmarkStylesPath = join(__dirname, "crawl-bookmark", "crawl-bookmark.styles.css");

export const ARTICLE_BODY_STYLES =
	ARTICLE_FRAME_STYLES + readFileSync(stylesPath, "utf-8") + readFileSync(crawlBookmarkStylesPath, "utf-8");
