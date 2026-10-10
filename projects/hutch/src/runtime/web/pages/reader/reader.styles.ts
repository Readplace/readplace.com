import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIRM_POPOVER_STYLES } from "@packages/web-shell";
import { ARTICLE_BODY_STYLES } from "../../shared/article-body/article-body.styles";
import { ISSUE_LINKS_STYLES } from "../../shared/issue-links/issue-links.styles";
import { NEXT_READ_STYLES } from "../../shared/next-read/next-read.styles";
import { PAST_READS_STYLES } from "../../shared/past-reads/past-reads.styles";
import { READING_LAYOUT_STYLES } from "../../shared/reading-layout/reading-layout.styles";
import { SHARE_BALLOON_STYLES } from "../../shared/share-balloon/share-balloon.styles";

const stylesPath = join(__dirname, "reader.styles.css");
export const READER_ONLY_STYLES = readFileSync(stylesPath, "utf-8");

export const READER_STYLES = `${ARTICLE_BODY_STYLES}\n${READING_LAYOUT_STYLES}\n${SHARE_BALLOON_STYLES}\n${NEXT_READ_STYLES}\n${PAST_READS_STYLES}\n${ISSUE_LINKS_STYLES}\n${READER_ONLY_STYLES}\n${CONFIRM_POPOVER_STYLES}`;
