import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(__dirname, "article-body.styles.css");
const crawlBookmarkStylesPath = join(__dirname, "crawl-bookmark", "crawl-bookmark.styles.css");
const relatedSlotStylesPath = join(__dirname, "related-slot", "related-slot.styles.css");

export const ARTICLE_BODY_STYLES =
	readFileSync(stylesPath, "utf-8") +
	readFileSync(crawlBookmarkStylesPath, "utf-8") +
	readFileSync(relatedSlotStylesPath, "utf-8");
