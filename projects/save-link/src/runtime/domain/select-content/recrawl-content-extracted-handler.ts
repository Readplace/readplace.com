import { initSelectionForwardHandler, initSelectionQueueHandler } from "./select-content-work";
import { SELECTION_SOURCE_POLICIES } from "./selection-source-policies";

export const initRecrawlContentExtractedHandler = initSelectionQueueHandler(SELECTION_SOURCE_POLICIES["recrawl-content-extracted"]);
export const initForwardRecrawlContentExtracted = initSelectionForwardHandler(SELECTION_SOURCE_POLICIES["recrawl-content-extracted"]);
