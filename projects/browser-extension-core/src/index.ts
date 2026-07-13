export { BrowserExtensionCore } from "./core";
export { resolveCanonicalUrlFromDocument } from "./resolve-canonical-url-from-document";
export type { Core, CoreError, ResultCallbacks, ReadingList } from "./core";
export type { BrowserShell } from "./shell.types";
export type { SetIcon } from "./icon-status";
export type {
	ReadingListItem,
	ReadingListItemId,
	ActionDescriptor,
	LinkDescriptor,
} from "./domain/reading-list-item.types";
export type {
	SaveUrlResult,
	SaveWarning,
	Message,
	InvokeActionResult,
} from "./reading-list/reading-list.types";
export type {
	Auth,
	GuardedResult,
	LoginResult,
	RefreshResult,
	OAuthAuthDeps,
	OAuthTokens,
	TokenStorage,
} from "./auth/auth.types";
export { OAuthTokensSchema } from "./auth/oauth-tokens";
export { initOAuthAuth } from "./auth/oauth-auth";
export { UnauthorizedError } from "./auth/unauthorized-error";
export {
	initSirenReadingList,
	initExtension,
	initSaveArticleUnderstanding,
	initSaveArticlesUnderstanding,
	initSaveHtmlUnderstanding,
	initSaveContentUnderstanding,
	initListArticlesUnderstanding,
	genericEntityAction,
	groupOf,
	httpCacheable,
} from "./reading-list/siren-reading-list";
export type {
	SirenReadingListDeps,
	ExtensionDeps,
	NavigationResult,
	ArticleItem,
	BoundAction,
} from "./reading-list/siren-reading-list";
export type { ContentBodyBuilder } from "./reading-list/content-body-parsers";
export { pdfContentBody, htmlContentBody } from "./reading-list/content-body-parsers";
export type { SaveUrl, InvokeAction, FindByUrl, GetAllItems, SavePages, BulkSavePage, BulkSaveResult } from "./reading-list/reading-list.types";
export type { PopupMessage } from "./popup-message.types";
export { filterByUrl } from "./popup/filter-by-url";
export { paginateItems } from "./popup/paginate-items";
export { avatarColor } from "./popup/avatar-color";
export { relativeTime } from "./popup/relative-time";
export { buildMessageView } from "./popup/message-view";
export type { MessageView } from "./popup/message-view";
export { isAppUrl } from "./popup/is-app-url";
export { itemDisplay } from "./popup/item-display";
export type { ItemDisplay } from "./popup/item-display";
export { actionIcon, actionLabel, actionVariant, humanize, linkLabel, linkPresentation } from "./popup/action-affordance";
export type { ActionVariant, LinkPresentation } from "./popup/action-affordance";
export { selectSaveableTabs, summarizeBulkSave } from "./popup/save-all-tabs";
export type { SaveableTab } from "./popup/save-all-tabs";
export { initSaveProgress } from "./popup/save-progress";
export type { SavePhase, SaveProgress } from "./popup/save-progress";
export { initSaveProgressSequencer } from "./popup/save-progress-sequencer";
export type { SaveProgressSequencer, Scheduler } from "./popup/save-progress-sequencer";
export {
	MENU_ITEM_SAVE_PAGE,
	MENU_ITEM_SAVE_LINK,
	MENU_ITEM_SAVE_ALL_TABS,
} from "./get-context-menu-target";
export { installShortcuts, isCmdD } from "./keydown-shortcuts";
export type { Shortcut } from "./keydown-shortcuts";
export { captureActiveTabBytes } from "./capture-active-tab-bytes";
export type { CapturedContent } from "./capture-active-tab-bytes";
export { isPdfViewerDocument } from "./is-pdf-viewer-document";
export type { TabContent } from "./reading-list/reading-list.types";

