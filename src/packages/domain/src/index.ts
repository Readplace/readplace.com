export * from "./article";
export * from "./article-aggregate";
export * from "./user";
export * from "./oauth";
export * from "./import-session";
export * from "./inbox";
export * from "./rate-limit";
export * from "./newsletter";
/** Both ./inbox and ./newsletter export a `buildInboxAddress`; the explicit
 * re-export pins the root-barrel name to ./inbox to resolve the wildcard
 * ambiguity (TS2308). Consumers of either reach their own via the subpath
 * exports (@packages/domain/inbox, @packages/domain/newsletter). */
export { buildInboxAddress } from "./inbox";
