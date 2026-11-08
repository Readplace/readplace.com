import { initSelectionForwardHandler, initSelectionQueueHandler } from "./select-content-work";
import { SELECTION_SOURCE_POLICIES } from "./selection-source-policies";

export const initSelectMostCompleteContentHandler = initSelectionQueueHandler(SELECTION_SOURCE_POLICIES["tier-content-extracted"]);
export const initForwardTierContentExtracted = initSelectionForwardHandler(SELECTION_SOURCE_POLICIES["tier-content-extracted"]);
