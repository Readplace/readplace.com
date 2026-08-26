package com.readplace.android.app

import com.readplace.android.core.Article
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
	fun `subtitle joins site, read time and saved-at with a middle dot`() {
		val row = ArticlePresentation.of(
			article(
				siteName = "example.com",
				readTimeLabel = "~5 min read",
				savedAt = Instant.parse("2026-08-25T07:00:00Z"),
			),
			clockAt("2026-08-25T10:00:00Z"),
		)
		assertEquals("example.com · ~5 min read · 3h ago", row.subtitle)
	}

	@Test
	fun `subtitle is null when no part carries a value`() {
		val row = ArticlePresentation.of(
			article(siteName = null, readTimeLabel = null, savedAt = null),
			clockAt("2026-08-25T10:00:00Z"),
		)
		assertNull(row.subtitle)
	}

	@Test
	fun `an empty site name and a read time the server withheld are left out`() {
		val row = ArticlePresentation.of(
			article(siteName = "", readTimeLabel = null, savedAt = Instant.parse("2026-08-24T10:00:00Z")),
			clockAt("2026-08-25T10:00:00Z"),
		)
		assertEquals("1d ago", row.subtitle)
	}

	@Test
	fun `a blank read time label is left out`() {
		val row = ArticlePresentation.of(
			article(readTimeLabel = "   ", savedAt = Instant.parse("2026-08-24T10:00:00Z")),
			clockAt("2026-08-25T10:00:00Z"),
		)
		assertEquals("1d ago", row.subtitle)
	}

	@Test
	fun `title and read state pass through`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		val read = ArticlePresentation.of(article(title = "A read article", isRead = true), clock)
		assertEquals("A read article", read.title)
		assertTrue(read.isRead)
		val unread = ArticlePresentation.of(article(title = "An unread article", isRead = false), clock)
		assertEquals("An unread article", unread.title)
		assertFalse(unread.isRead)
	}

	@Test
	fun `excerpt is shown only when the server sent a non-empty one`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		assertNull(ArticlePresentation.of(article(excerpt = null), clock).excerpt)
		assertNull(ArticlePresentation.of(article(excerpt = ""), clock).excerpt)
		assertEquals("A summary.", ArticlePresentation.of(article(excerpt = "A summary."), clock).excerpt)
	}

	@Test
	fun `thumbnail url is the image url only when it is a loadable url`() {
		val clock = clockAt("2026-08-25T10:00:00Z")
		assertNull(ArticlePresentation.of(article(imageUrl = null), clock).thumbnailUrl)
		assertNull(ArticlePresentation.of(article(imageUrl = ""), clock).thumbnailUrl)
		assertNull(ArticlePresentation.of(article(imageUrl = "file:///sdcard/a.jpg"), clock).thumbnailUrl)
		assertEquals(
			"an odd-but-reachable URL is handed to the loader as sent, as Foundation's URL " +
				"percent-encodes it on iOS, rather than being refused",
			"https://cdn.example.com/a b.jpg",
			ArticlePresentation.of(article(imageUrl = "https://cdn.example.com/a b.jpg"), clock).thumbnailUrl,
		)
		assertEquals(
			"https://cdn.example.com/a.jpg",
			ArticlePresentation.of(article(imageUrl = "https://cdn.example.com/a.jpg"), clock).thumbnailUrl,
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

	// endregion

	private fun savedAtWording(savedAt: String, now: String, zone: ZoneId = ZoneOffset.UTC): String? =
		ArticlePresentation.of(article(savedAt = Instant.parse(savedAt)), clockAt(now, zone)).subtitle

	private fun clockAt(iso: String, zone: ZoneId = ZoneOffset.UTC): Clock = Clock.fixed(Instant.parse(iso), zone)

	private fun article(
		title: String = "An article",
		siteName: String? = null,
		excerpt: String? = null,
		imageUrl: String? = null,
		readTimeLabel: String? = null,
		isRead: Boolean = false,
		savedAt: Instant? = null,
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
	)
}
