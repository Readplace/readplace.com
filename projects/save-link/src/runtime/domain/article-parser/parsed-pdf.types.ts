import type { UserId } from "@packages/article-state-types";

export type FindParsedPdf = (key: { userId: UserId; fileHash: string }) => Promise<{ html: string; title: string } | undefined>;

export type KeepParsedPdf = (parse: { userId: UserId; fileHash: string; html: string; title: string }) => Promise<void>;
