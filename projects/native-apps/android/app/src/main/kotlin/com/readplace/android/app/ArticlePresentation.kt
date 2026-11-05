package com.readplace.android.app

import com.readplace.android.core.Article
import com.readplace.android.core.CrawlEstimate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.abs

/**
 * The text a reading-list row renders for an article, derived once from the model
 * so the wording decisions stay pure and unit-tested while the Compose layout that
 * paints them is the untested OS boundary — the same split as `ReaderLoad`.
 */
data class ArticlePresentation(
	val title: String,
	/** `read-time · saved-at`, where the read time is the server's own label
	 * rendered verbatim. Each part is present only when it carries a value; null when
	 * none does, so the row omits the line rather than painting an empty one. */
	val metaText: String?,
	/** The excerpt, or null when the server sent none or an
	 * empty one. */
	val excerpt: String?,
	val isRead: Boolean,
	val statusLabel: String,
	/** The image to load for the thumbnail, or null when the article carries no
	 * loadable URL. */
	val thumbnailUrl: String?,
	val processingLabel: String?,
	val notice: String?,
	private val estimate: CrawlEstimate?,
) {
	fun estimateText(receivedAt: Instant?, now: Instant): String? {
		if (receivedAt == null) return null
		val elapsed = maxOf(0L, Duration.between(receivedAt, now).seconds)
		return when (estimate) {
			null -> null
			is CrawlEstimate.Quiet ->
				if (elapsed < estimate.revealInSeconds) null else remainingWording(estimate.seconds - elapsed)
			is CrawlEstimate.Counting -> remainingWording(estimate.seconds - elapsed)
			CrawlEstimate.AlmostThere -> ALMOST_THERE
		}
	}

	companion object {
		private const val ALMOST_THERE = "Almost there…"

		private fun remainingWording(seconds: Long): String = if (seconds > 0) "~$seconds s left" else ALMOST_THERE

		fun of(article: Article, clock: Clock): ArticlePresentation = ArticlePresentation(
			title = article.title,
			metaText = if (article.processing != null) null else metaText(article, clock),
			excerpt = article.excerpt?.takeIf { it.isNotEmpty() },
			isRead = article.isRead,
			statusLabel = if (article.isRead) "Read" else "Unread",
			thumbnailUrl = article.imageUrl?.takeIf { isWebUrl(it) },
			processingLabel = article.processing?.label,
			notice = article.notice,
			estimate = article.processing?.estimate,
		)

		private fun metaText(article: Article, clock: Clock): String? {
			val parts = mutableListOf<String>()
			article.readTimeLabel?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
			article.savedAt?.let { parts.add(RelativeTime.wording(it, clock)) }
			return if (parts.isEmpty()) null else parts.joinToString(" · ")
		}

		/** A loadable image is any http(s) reference, handed to the loader as the
		 * server sent it: the image loader percent-encodes a space or bracket the way
		 * Foundation's `URL` does, so a URL that is odd but reachable still loads
		 * rather than falling to the placeholder. */
		private fun isWebUrl(raw: String): Boolean =
			raw.startsWith("http://", ignoreCase = true) || raw.startsWith("https://", ignoreCase = true)
	}
}

/**
 * The row's saved-at wording, in the abbreviated style the iOS row gets from
 * `RelativeDateTimeFormatter` with `.abbreviated` units (`3h ago`, `1mo ago`,
 * `in 2d`) so both clients read alike. The unit is the largest one with a whole
 * count between the clock's instant and the date, measured on the calendar in the
 * clock's zone: a month is a calendar month, not thirty days, and a count of zero
 * reads as the future form.
 */
private object RelativeTime {
	fun wording(date: Instant, clock: Clock): String {
		val from = clock.instant().atZone(clock.zone)
		val to = date.atZone(clock.zone)
		for (unit in RelativeUnit.entries) {
			val count = unit.chrono.between(from, to)
			if (count != 0L) return phrase(count, unit)
		}
		return phrase(0L, RelativeUnit.SECONDS)
	}

	private fun phrase(count: Long, unit: RelativeUnit): String {
		val magnitude = abs(count)
		return if (count < 0L) "$magnitude${unit.label} ago" else "in $magnitude${unit.label}"
	}
}

/** Largest first: the wording picks the first unit with a whole count. */
private enum class RelativeUnit(val chrono: ChronoUnit, val label: String) {
	YEARS(ChronoUnit.YEARS, "y"),
	MONTHS(ChronoUnit.MONTHS, "mo"),
	WEEKS(ChronoUnit.WEEKS, "w"),
	DAYS(ChronoUnit.DAYS, "d"),
	HOURS(ChronoUnit.HOURS, "h"),
	MINUTES(ChronoUnit.MINUTES, "m"),
	SECONDS(ChronoUnit.SECONDS, "s"),
}
