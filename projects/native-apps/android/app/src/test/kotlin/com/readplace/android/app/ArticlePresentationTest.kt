package com.readplace.android.app

import com.readplace.android.core.Article
import com.readplace.android.core.ArticleProcessing
import com.readplace.android.core.ArticleSender
import com.readplace.android.core.ArticleVia
import com.readplace.android.core.SirenLink
import com.readplace.android.core.CrawlEstimate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class ArticlePresentationTest {
	@Test
	fun `meta text joins read time and saved-at with a middle dot`() {
		val row = ArticlePresentation.of(
			article(
				readTimeLabel = "~5 min read",
				savedAt = Instant.parse("2026-08-25T07:00:00Z"),
			),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("~5 min read · 3h ago", row.metaText)
	}

	@Test
	fun `the site name is left out of the meta line`() {
		val row = ArticlePresentation.of(
			article(
				siteName = "example.com",
				readTimeLabel = "~5 min read",
				savedAt = Instant.parse("2026-08-25T07:00:00Z"),
			),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("~5 min read · 3h ago", row.metaText)
	}

	@Test
	fun `a site-only article has no meta text`() {
		val row = ArticlePresentation.of(
			article(siteName = "example.com", readTimeLabel = null, savedAt = null),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertNull(row.metaText)
	}

	@Test
	fun `meta text is null when neither read time nor saved-at carries a value`() {
		val row = ArticlePresentation.of(
			article(readTimeLabel = null, savedAt = null),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertNull(row.metaText)
	}

	@Test
	fun `meta text is only the read time when the saved-at is missing`() {
		val row = ArticlePresentation.of(
			article(readTimeLabel = "~5 min read", savedAt = null),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("~5 min read", row.metaText)
	}

	@Test
	fun `meta text is only the saved-at when the read time is missing or blank`() {
		val missing = ArticlePresentation.of(
			article(readTimeLabel = null, savedAt = Instant.parse("2026-08-24T10:00:00Z")),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		val blank = ArticlePresentation.of(
			article(readTimeLabel = "   ", savedAt = Instant.parse("2026-08-24T10:00:00Z")),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("1d ago", missing.metaText)
		assertEquals("1d ago", blank.metaText)
	}

	@Test
	fun `title, read state and status label pass through`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		val read = ArticlePresentation.of(article(title = "A read article", isRead = true), clock, isAvailableOffline = false)
		assertEquals("A read article", read.title)
		assertTrue(read.isRead)
		assertEquals("Read", read.statusLabel)
		val unread = ArticlePresentation.of(article(title = "An unread article", isRead = false), clock, isAvailableOffline = false)
		assertEquals("An unread article", unread.title)
		assertFalse(unread.isRead)
		assertEquals("Unread", unread.statusLabel)
	}

	@Test
	fun `a row saved offline carries the badge label, and one that is not carries none`() {
		val clock = clockAt("2026-08-25T10:00:00Z")

		assertEquals(
			listOf("Saved offline", null),
			listOf(true, false).map { ArticlePresentation.of(article(), clock, isAvailableOffline = it).offlineBadgeLabel },
		)
	}

	@Test
	fun `excerpt is shown only when the server sent a non-empty one`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		assertNull(ArticlePresentation.of(article(excerpt = null), clock, isAvailableOffline = false).excerpt)
		assertNull(ArticlePresentation.of(article(excerpt = ""), clock, isAvailableOffline = false).excerpt)
		assertEquals("A summary.", ArticlePresentation.of(article(excerpt = "A summary."), clock, isAvailableOffline = false).excerpt)
	}

	@Test
	fun `thumbnail url is the image url only when it is a loadable url`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		assertNull(ArticlePresentation.of(article(imageUrl = null), clock, isAvailableOffline = false).thumbnailUrl)
		assertNull(ArticlePresentation.of(article(imageUrl = ""), clock, isAvailableOffline = false).thumbnailUrl)
		assertNull(ArticlePresentation.of(article(imageUrl = "file:///sdcard/a.jpg"), clock, isAvailableOffline = false).thumbnailUrl)
		assertEquals(
			"an odd-but-reachable URL is handed to the loader as sent, as Foundation's URL " +
				"percent-encodes it on iOS, rather than being refused",
			"https://cdn.example.com/a b.jpg",
			ArticlePresentation.of(article(imageUrl = "https://cdn.example.com/a b.jpg"), clock, isAvailableOffline = false).thumbnailUrl,
		)
		assertEquals(
			"https://cdn.example.com/a.jpg",
			ArticlePresentation.of(article(imageUrl = "https://cdn.example.com/a.jpg"), clock, isAvailableOffline = false).thumbnailUrl,
		)
	}

	// region Saved-at wording

	@Test
	fun `saved-at counts whole seconds, minutes and hours ago`() {
		assertEquals("1s ago", savedAtWording(savedAt = "2026-08-25T09:59:59Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("30s ago", savedAtWording(savedAt = "2026-08-25T09:59:30Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("5m ago", savedAtWording(savedAt = "2026-08-25T09:55:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("59m ago", savedAtWording(savedAt = "2026-08-25T09:00:01Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("1h ago", savedAtWording(savedAt = "2026-08-25T09:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("3h ago", savedAtWording(savedAt = "2026-08-25T07:00:00Z", now = "2026-08-25T10:00:00Z"))
	}

	@Test
	fun `saved-at counts whole days and weeks ago, in the abbreviated single-letter style`() {
		assertEquals("23h ago", savedAtWording(savedAt = "2026-08-24T10:00:01Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("1d ago", savedAtWording(savedAt = "2026-08-24T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("2d ago", savedAtWording(savedAt = "2026-08-23T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("1w ago", savedAtWording(savedAt = "2026-08-18T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("1w ago", savedAtWording(savedAt = "2026-08-12T10:00:01Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("2w ago", savedAtWording(savedAt = "2026-08-11T10:00:00Z", now = "2026-08-25T10:00:00Z"))
	}

	@Test
	fun `a month is a calendar month, not thirty days`() {
		assertEquals("4w ago", savedAtWording(savedAt = "2026-07-25T10:00:01Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("1mo ago", savedAtWording(savedAt = "2026-07-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("2mo ago", savedAtWording(savedAt = "2026-06-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		// Twenty-eight days is a whole month when it spans February.
		assertEquals("1mo ago", savedAtWording(savedAt = "2026-02-01T10:00:00Z", now = "2026-03-01T10:00:00Z"))
	}

	@Test
	fun `a year is a calendar year`() {
		assertEquals("11mo ago", savedAtWording(savedAt = "2025-08-25T10:00:01Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("1y ago", savedAtWording(savedAt = "2025-08-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("2y ago", savedAtWording(savedAt = "2024-08-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
	}

	@Test
	fun `a saved-at ahead of the clock reads as the future form`() {
		assertEquals("in 45s", savedAtWording(savedAt = "2026-08-25T10:00:45Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 5m", savedAtWording(savedAt = "2026-08-25T10:05:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 2h", savedAtWording(savedAt = "2026-08-25T12:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 1d", savedAtWording(savedAt = "2026-08-26T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 2d", savedAtWording(savedAt = "2026-08-27T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 1w", savedAtWording(savedAt = "2026-09-01T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 1mo", savedAtWording(savedAt = "2026-09-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 1y", savedAtWording(savedAt = "2027-08-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
	}

	@Test
	fun `a saved-at within the same second reads as zero seconds in the future form`() {
		assertEquals("in 0s", savedAtWording(savedAt = "2026-08-25T10:00:00Z", now = "2026-08-25T10:00:00Z"))
		assertEquals("in 0s", savedAtWording(savedAt = "2026-08-25T09:59:59.500Z", now = "2026-08-25T10:00:00Z"))
	}

	@Test
	fun `the calendar is read in the clock's zone`() {
		// The same two instants fall on Jan 29 → Feb 28 in UTC (no whole month) but
		// on Jan 30 → Mar 1 thirteen hours east (a whole month).
		assertEquals(
			"4w ago",
			savedAtWording(savedAt = "2026-01-29T12:00:00Z", now = "2026-02-28T11:00:00Z", zone = ZoneOffset.UTC),
		)
		assertEquals(
			"1mo ago",
			savedAtWording(savedAt = "2026-01-29T12:00:00Z", now = "2026-02-28T11:00:00Z", zone = ZoneOffset.ofHours(13)),
		)
	}

	@Test
	fun `the server's kind label stands in for the read time, so the length shows once`() {
		val row = ArticlePresentation.of(
			article(kindLabel = "Book · 12 chapters · 3 h read", readTimeLabel = "3 h read", savedAt = Instant.parse("2026-08-25T07:00:00Z")),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("Book · 12 chapters · 3 h read · 3h ago", row.metaText)
	}

	@Test
	fun `a public source opens its original, and a private one is text alone`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		val public = ArticlePresentation.of(article(siteName = "Example", originalUrl = "https://example.com/a"), clock, isAvailableOffline = false)
		val private = ArticlePresentation.of(article(siteName = "Dune"), clock, isAvailableOffline = false)
		assertEquals(ArticlePresentation.Source(label = "Example", originalUrl = "https://example.com/a"), public.source)
		assertEquals("Open Example in browser", public.source?.actionLabel)
		assertEquals(ArticlePresentation.Source(label = "Dune", originalUrl = null), private.source)
		assertNull(private.source?.actionLabel)
	}

	@Test
	fun `a row with no site name has no source line`() {
		val row = ArticlePresentation.of(article(siteName = " ", originalUrl = "https://example.com/a"), clockAt("2026-08-25T10:00:00Z"), isAvailableOffline = false)
		assertNull(row.source)
	}

	@Test
	fun `only a recognised newsletter offers its sender behind a disclosure`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		val named = ArticlePresentation.of(
			article(via = ArticleVia(label = "via TLDR", sender = ArticleSender(name = "TLDR", address = "dan@tldr.tech"))),
			clock,
			isAvailableOffline = false,
		)
		val plain = ArticlePresentation.of(article(via = ArticleVia(label = "via someone@example.com", sender = null)), clock, isAvailableOffline = false)
		assertEquals("Sender details for via TLDR", named.via?.disclosureLabel)
		assertEquals(ArticleSender(name = "TLDR", address = "dan@tldr.tech"), named.via?.sender)
		assertEquals("via someone@example.com", plain.via?.label)
		assertNull(plain.via?.disclosureLabel)
	}

	@Test
	fun `a processing row hides its source and sender until the work settles`() {
		val row = ArticlePresentation.of(
			article(
				siteName = "Example",
				originalUrl = "https://example.com/a",
				via = ArticleVia(label = "via TLDR", sender = null),
				processing = processing(estimate = null),
			),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertNull(row.source)
		assertNull(row.via)
	}

	@Test
	fun `a failed upload offers recovery only while the server advertises it, beside the offline badge`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		val failed = ArticlePresentation.of(
			article(uploadAgainLink = SirenLink(rel = listOf("upload-again"), href = "/upload", title = null), suggestion = "Added by Readplace"),
			clock,
			isAvailableOffline = true,
		)
		val settled = ArticlePresentation.of(article(), clock, isAvailableOffline = false)
		assertEquals("Upload again", failed.recoveryLabel)
		assertEquals("Saved offline", failed.offlineBadgeLabel)
		assertEquals("Added by Readplace", failed.suggestion)
		assertNull(settled.recoveryLabel)
	}

	// endregion

	private fun savedAtWording(savedAt: String, now: String, zone: ZoneId = ZoneOffset.UTC): String? =
		ArticlePresentation.of(article(savedAt = Instant.parse(savedAt)), clockAt(now, zone), isAvailableOffline = false).metaText

	private fun clockAt(iso: String, zone: ZoneId = ZoneOffset.UTC): Clock = Clock.fixed(Instant.parse(iso), zone)

	private fun article(
		title: String = "An article",
		siteName: String? = null,
		excerpt: String? = null,
		imageUrl: String? = null,
		readTimeLabel: String? = null,
		isRead: Boolean = false,
		savedAt: Instant? = null,
		processing: ArticleProcessing? = null,
		notice: String? = null,
		contentVersion: String? = null,
		kindLabel: String? = null,
		suggestion: String? = null,
		via: ArticleVia? = null,
		originalUrl: String? = null,
		uploadAgainLink: SirenLink? = null,
	): Article = Article(
		id = "a1",
		url = "https://example.com/a",
		title = title,
		siteName = siteName,
		excerpt = excerpt,
		imageUrl = imageUrl,
		readTimeLabel = readTimeLabel,
		isRead = isRead,
		savedAt = savedAt,
		actions = emptyList(),
		links = emptyList(),
		readHref = null,
		processing = processing,
		notice = notice,
		contentVersion = contentVersion,
		kindLabel = kindLabel,
		suggestion = suggestion,
		via = via,
		originalUrl = originalUrl,
		uploadAgainLink = uploadAgainLink,
	)

	private fun processing(estimate: CrawlEstimate?, label: String = "Processing"): ArticleProcessing =
		ArticleProcessing(label = label, estimate = estimate, refreshHref = "/queue/a1/card?poll=1", refreshAfterSeconds = 3)

	private val receivedAt = Instant.parse("2026-08-25T10:00:00Z")

	private fun estimateText(estimate: CrawlEstimate?, elapsedSeconds: Long): String? =
		ArticlePresentation.of(article(processing = processing(estimate)), clockAt("2026-08-25T10:00:00Z"), isAvailableOffline = false)
			.estimateText(receivedAt, receivedAt.plusSeconds(elapsedSeconds))

	@Test
	fun `a processing row hides its meta line`() {
		val row = ArticlePresentation.of(
			article(
				readTimeLabel = "~5 min read",
				savedAt = Instant.parse("2026-08-25T07:00:00Z"),
				processing = processing(estimate = null),
			),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertNull(row.metaText)
	}

	@Test
	fun `a row with no processing has no processing label`() {
		val row = ArticlePresentation.of(article(), clockAt("2026-08-25T10:00:00Z"), isAvailableOffline = false)
		assertNull(row.processingLabel)
		assertNull(row.estimateText(receivedAt, receivedAt))
	}

	@Test
	fun `the processing label is the server's text verbatim`() {
		val row = ArticlePresentation.of(
			article(processing = processing(estimate = null, label = "Preparing your book…")),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("Preparing your book…", row.processingLabel)
	}

	@Test
	fun `a quiet estimate shows nothing until its reveal then counts down the remainder`() {
		val quiet = CrawlEstimate.Quiet(revealInSeconds = 5, seconds = 121)
		assertNull(estimateText(quiet, elapsedSeconds = 4))
		assertEquals("~116 s left", estimateText(quiet, elapsedSeconds = 5))
	}

	@Test
	fun `a counting estimate shows the seconds minus whole elapsed seconds`() {
		assertEquals("~121 s left", estimateText(CrawlEstimate.Counting(seconds = 121), elapsedSeconds = 0))
		assertEquals("~101 s left", estimateText(CrawlEstimate.Counting(seconds = 121), elapsedSeconds = 20))
	}

	@Test
	fun `a part-second elapsed rounds down and a clock behind the stamp counts as no time`() {
		val row = ArticlePresentation.of(
			article(processing = processing(CrawlEstimate.Counting(seconds = 10))),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertEquals("~9 s left", row.estimateText(receivedAt, receivedAt.plusMillis(1_999)))
		assertEquals("~10 s left", row.estimateText(receivedAt, receivedAt.minusSeconds(30)))
	}

	@Test
	fun `an estimate at or past zero reads almost there`() {
		assertEquals("Almost there…", estimateText(CrawlEstimate.Counting(seconds = 3), elapsedSeconds = 3))
		assertEquals("Almost there…", estimateText(CrawlEstimate.Counting(seconds = 3), elapsedSeconds = 40))
		assertEquals(
			"Almost there…",
			estimateText(CrawlEstimate.Quiet(revealInSeconds = 5, seconds = 5), elapsedSeconds = 5),
		)
	}

	@Test
	fun `the almost-there kind reads almost there from the start`() {
		assertEquals("Almost there…", estimateText(CrawlEstimate.AlmostThere, elapsedSeconds = 0))
	}

	@Test
	fun `no estimate or no received-at stamp shows nothing`() {
		assertNull(estimateText(estimate = null, elapsedSeconds = 10))
		val row = ArticlePresentation.of(
			article(processing = processing(CrawlEstimate.Counting(seconds = 10))),
			clockAt("2026-08-25T10:00:00Z"),
			isAvailableOffline = false,
		)
		assertNull(row.estimateText(receivedAt = null, now = receivedAt))
	}

	@Test
	fun `the notice is the article's notice text`() {
		val row = ArticlePresentation.of(article(notice = "Taking a while."), clockAt("2026-08-25T10:00:00Z"), isAvailableOffline = false)
		assertEquals("Taking a while.", row.notice)
		assertNull(ArticlePresentation.of(article(), clockAt("2026-08-25T10:00:00Z"), isAvailableOffline = false).notice)
	}
}
