package com.readplace.android.core

/**
 * The reader's answer to "where do shared articles drop?": [Unasked] until they
 * answer once, then [Chosen] with the set of extra readlist hrefs. The mainline
 * root is always implied and never stored, so a [Chosen] empty set is a real
 * answer — "mainline only" — distinct from never having been asked.
 */
sealed interface SharedArticlesDropChoice {
	data object Unasked : SharedArticlesDropChoice

	data class Chosen(override val hrefs: Set<String>) : SharedArticlesDropChoice

	val hrefs: Set<String> get() = (this as? Chosen)?.hrefs ?: emptySet()

	val isDecided: Boolean get() = this is Chosen
}

/**
 * The persisted share-destination choice, held under one storage key. A missing
 * value means [SharedArticlesDropChoice.Unasked]; any written set — even empty —
 * means the reader has answered. Sets are copied crossing the boundary so a fresh
 * store instance reads previous writes and no caller mutates the stored set in
 * place.
 */
class ShareTarget(private val storage: ReaderChoiceStorage) {
	private val stored: SharedArticlesDropChoice
		get() = storage.getStringSet(KEY)
			?.let { SharedArticlesDropChoice.Chosen(it.toSet()) }
			?: SharedArticlesDropChoice.Unasked

	val hrefs: Set<String> get() = stored.hrefs

	val isDecided: Boolean get() = stored.isDecided

	fun record(hrefs: Set<String>) {
		storage.putStringSet(KEY, hrefs.toSet())
	}

	fun add(href: String) {
		record(hrefs + href)
	}

	fun remove(href: String) {
		record(hrefs - href)
	}

	fun forget() {
		storage.remove(KEY)
	}

	private companion object {
		const val KEY = "shareTarget.readlistHrefs"
	}
}
