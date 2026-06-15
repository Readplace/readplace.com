import assert from "node:assert";
import { createHash } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { z } from "zod";

const HASH_PATTERN = /^[0-9a-f]{32}$/;

export class ReaderArticleHashId {
	readonly value: string;
	private constructor(value: string) {
		this.value = value;
	}

	static from(url: string): ReaderArticleHashId {
		const resourceId = ArticleResourceUniqueId.parse(url);
		const hash = createHash("sha256").update(resourceId.value).digest("hex").slice(0, 32);
		return new ReaderArticleHashId(hash);
	}

	static fromHash(hash: string): ReaderArticleHashId {
		assert(HASH_PATTERN.test(hash), `Invalid ReaderArticleHashId: ${hash}`);
		return new ReaderArticleHashId(hash);
	}

	toJSON(): string {
		return this.value;
	}

	toString(): string {
		return this.value;
	}
}

export const ReaderArticleHashIdSchema = z
	.string() /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
	.regex(HASH_PATTERN)
	.transform((s) => ReaderArticleHashId.fromHash(s));
