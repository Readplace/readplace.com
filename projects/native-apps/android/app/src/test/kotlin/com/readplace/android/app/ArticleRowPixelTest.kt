package com.readplace.android.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import com.readplace.android.core.Article
import com.readplace.android.core.ArticleSender
import com.readplace.android.core.ArticleVia
import com.readplace.android.pixel.Appearance
import com.readplace.android.pixel.PIXEL_DEVICE
import com.readplace.android.pixel.PixelCheckpoint
import com.readplace.android.pixel.assertMatchesBaseline
import com.readplace.android.pixel.captureLeaf
import com.readplace.android.testing.ComposeHostActivityRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PIXEL_DEVICE)
class ArticleRowPixelTest {
	@get:Rule(order = 0) val host = ComposeHostActivityRule()

	@get:Rule(order = 1) val compose = createAndroidComposeRule<ComponentActivity>()

	private val unread = Article(
		id = "a1",
		url = "https://example.com/a1",
		title = "A long read about tides",
		siteName = "Example",
		excerpt = "An excerpt long enough to wrap onto a second line in the row so the layout shows its real height.",
		imageUrl = null,
		readTimeLabel = "~6 min read",
		isRead = false,
		savedAt = null,
		actions = emptyList(),
		links = emptyList(),
		readHref = "/queue/a1/view",
		processing = null,
		notice = null,
		contentVersion = null,
	)

	private val fromNewsletter = unread.copy(
		id = "a2",
		siteName = "A publication with a long name",
		originalUrl = "https://example.com/a2",
		via = ArticleVia(label = "via The Weekly Newsletter", sender = ArticleSender(name = "The Weekly", address = "editor@weekly.example")),
		suggestion = "Added by Readplace from Hacker News",
	)

	private fun assertRow(article: Article, name: String, appearance: Appearance) {
		val capture = compose.captureLeaf(appearance = appearance) {
			ArticleRow(
				article = article,
				clock = Clock.fixed(Instant.parse("2026-11-12T00:00:00Z"), ZoneOffset.UTC),
				processingReceivedAt = null,
				isAvailableOffline = false,
				onOpen = {},
				onOpenOriginal = {},
				onRecover = {},
			)
		}
		assertMatchesBaseline(
			checkpoint = PixelCheckpoint(suite = "ArticleRowPixelTest", name = name, appearance = appearance),
			capture = capture,
		)
	}

	private fun assertUnreadRow(appearance: Appearance) = assertRow(unread, "article-row", appearance)

	@Test
	fun `an unread row looks right in light`() = assertUnreadRow(Appearance.Light)

	@Test
	fun `an unread row looks right in dark`() = assertUnreadRow(Appearance.Dark)

	@Test
	fun `a newsletter row with its source and sender looks right in light`() = assertRow(fromNewsletter, "article-row-source", Appearance.Light)

	@Test
	fun `a newsletter row with its source and sender looks right in dark`() = assertRow(fromNewsletter, "article-row-source", Appearance.Dark)
}
