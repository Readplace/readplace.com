package com.readplace.android.core

/**
 * One readlist's row in the "where do shared articles drop?" surfaces (the list's
 * drop row and the share chooser). Mainline is [Always] — locked and checked,
 * because every save drops there — while an extra readlist is [Ticked] or
 * [Unticked] by whether the reader chose it. Mainline is identified only by the
 * advertised root href; a readlist is never guessed to be mainline from its label
 * or position.
 */
sealed interface SharedArticlesDrop {
	data class Always(override val label: String) : SharedArticlesDrop

	data class Ticked(val readlist: Readlist) : SharedArticlesDrop {
		override val label: String get() = readlist.label
	}

	data class Unticked(val readlist: Readlist) : SharedArticlesDrop {
		override val label: String get() = readlist.label
	}

	val label: String

	/** The readlist this row toggles, or null for locked mainline. */
	val choice: Readlist? get() = when (this) {
		is Always -> null
		is Ticked -> readlist
		is Unticked -> readlist
	}

	/** Whether the row shows a tick — always for mainline and a chosen extra. */
	val showsTick: Boolean get() = when (this) {
		is Always, is Ticked -> true
		is Unticked -> false
	}

	companion object {
		fun of(readlist: Readlist, mainlineHref: String?, tickedHrefs: Set<String>): SharedArticlesDrop = when {
			readlist.href == mainlineHref -> Always(label = readlist.label)
			tickedHrefs.contains(readlist.href) -> Ticked(readlist)
			else -> Unticked(readlist)
		}

		/** The rows for a first, never-answered ask: every extra starts unticked. */
		fun firstAsk(readlists: List<Readlist>, mainlineHref: String?): List<SharedArticlesDrop> =
			readlists.map { of(it, mainlineHref, tickedHrefs = emptySet()) }
	}
}

/** The reader-facing copy for a [SharedArticlesDrop], kept out of the Compose layer
 * so the strings are asserted in unit tests. Icons, tints and touch targets are the
 * view's own presentation, derived there from [SharedArticlesDrop.showsTick] and
 * [SharedArticlesDrop.choice]. */
object SharedArticlesDropPresentation {
	fun title(drop: SharedArticlesDrop): String =
		if (drop.showsTick) "Shared articles drop here" else "Want shared article to drop here?"

	/** The explanation shown for locked mainline (and only mainline): articles
	 * always land there and reading one marks it read across every readlist. Null
	 * for a toggleable extra, which needs none. */
	fun explanation(drop: SharedArticlesDrop): String? =
		if (drop.choice == null) {
			"Articles always drop on ${drop.label}. Reading one marks as read in all readlists."
		} else {
			null
		}
}
