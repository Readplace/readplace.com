import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERT_STYLES, IN_FLIGHT_DOTS_STYLES, TLDR_DISCLOSURE_STYLES } from "@packages/web-shell";
import { DISCLOSURE_CARD_STYLES } from "../disclosure-card/disclosure-card.styles";
import { SENDER_POPOVER_STYLES } from "../sender-popover/sender-popover.styles";
import { ARTICLE_FRAME_STYLES } from "./article-frame.styles";

const stylesPath = join(__dirname, "article-body.styles.css");
const articleHistoryStylesPath = join(__dirname, "article-history", "article-history.styles.css");
const progressBarStylesPath = join(__dirname, "progress-bar.styles.css");
const pipelinePanelStylesPath = join(__dirname, "pipeline-panel.styles.css");

export const ARTICLE_BODY_STYLES =
	DISCLOSURE_CARD_STYLES +
	ARTICLE_FRAME_STYLES +
	SENDER_POPOVER_STYLES +
	IN_FLIGHT_DOTS_STYLES +
	ALERT_STYLES +
	TLDR_DISCLOSURE_STYLES +
	readFileSync(stylesPath, "utf-8") +
	readFileSync(articleHistoryStylesPath, "utf-8") +
	readFileSync(progressBarStylesPath, "utf-8") +
	readFileSync(pipelinePanelStylesPath, "utf-8");
