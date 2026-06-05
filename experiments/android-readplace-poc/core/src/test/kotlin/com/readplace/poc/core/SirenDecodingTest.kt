package com.readplace.poc.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SirenDecodingTest {
	private fun decodeArticle(json: String): Article? =
		Article.from(SirenJson.decodeFromString(SirenEntity.serializer(), json))

	private fun decodeQueue(json: String): QueuePage =
		QueuePage(SirenJson.decodeFromString(SirenCollection.serializer(), json))

	@Test
	fun `decodes a rich article entity`() {
		val article = decodeArticle(Fixtures.article(id = "a1")).orFail()
		assertEquals("a1", article.id)
		assertEquals("A Title", article.title)
		assertEquals("Example", article.siteName)
		assertEquals(6, article.readTimeMinutes)
		assertEquals("https://example.com/img.png", article.imageUrl)
		assertEquals("/queue/a1/delete", article.deleteHref)
		assertEquals("/queue/a1/view", article.readHref)
		assertFalse(article.isRead)
	}

	@Test
	fun `decodes a minimal entity with only id and url`() {
		val article = decodeArticle("""{ "properties": { "id": "min", "url": "https://example.com/min" } }""").orFail()
		assertEquals("min", article.id)
		assertEquals("https://example.com/min", article.title)
		assertNull(article.siteName)
		assertNull(article.imageUrl)
		assertNull(article.deleteHref)
	}

	@Test
	fun `falls back to the url when the title is missing or empty`() {
		assertEquals("https://example.com/post", decodeArticle(Fixtures.article(title = null))?.title)
		assertEquals("https://example.com/post", decodeArticle(Fixtures.article(title = ""))?.title)
	}

	@Test
	fun `treats a null image as absent`() {
		assertNull(decodeArticle(Fixtures.article(imageUrl = null)).orFail().imageUrl)
	}

	@Test
	fun `marks an article read from status or a present readAt`() {
		assertTrue(decodeArticle(Fixtures.article(status = "read")).orFail().isRead)
		assertTrue(decodeArticle(Fixtures.article(status = "unread", readAt = "2026-05-31T08:00:00Z")).orFail().isRead)
		assertFalse(decodeArticle(Fixtures.article(status = "unread", readAt = null)).orFail().isRead)
	}

	@Test
	fun `drops an entity that has no properties`() {
		val page = decodeQueue(
			Fixtures.collection(entitiesJson = listOf("""{ "class": ["article"] }""", Fixtures.article(id = "ok"))),
		)
		assertEquals(listOf("ok"), page.articles.map { it.id })
	}

	@Test
	fun `handles an empty collection`() {
		val page = decodeQueue(Fixtures.collection(entitiesJson = emptyList(), total = 0))
		assertTrue(page.articles.isEmpty())
		assertEquals(0, page.total)
	}

	@Test
	fun `surfaces self next and prev pagination links`() {
		val extraLinks = """, { "rel": ["next"], "href": "/queue?page=2" }, { "rel": ["prev"], "href": "/queue?page=0" }"""
		val page = decodeQueue(Fixtures.collection(entitiesJson = listOf(Fixtures.article()), extraLinks = extraLinks, page = 1))
		assertEquals("/queue?page=1", page.selfHref)
		assertEquals("/queue?page=2", page.nextHref)
		assertEquals("/queue?page=0", page.prevHref)
	}

	@Test
	fun `surfaces collection-level save actions`() {
		val page = decodeQueue(Fixtures.collection(entitiesJson = listOf(Fixtures.article())))
		assertEquals("/queue", page.saveArticleAction?.href)
		assertEquals("/queue/save-html", page.saveHtmlAction?.href)
	}

	@Test
	fun `surfaces a collection warning`() {
		val json = """
		{
		  "class": ["collection"],
		  "properties": { "total": 0, "warning": { "code": "unsupported_scheme", "message": "Cannot save chrome:// URLs" } },
		  "entities": [],
		  "actions": []
		}
		""".trimIndent()
		assertEquals("unsupported_scheme", decodeQueue(json).warning?.code)
	}

	@Test
	fun `parses iso-8601 dates with and without fractional seconds`() {
		assertNotNull(decodeArticle(Fixtures.article(savedAt = "2026-05-30T10:00:00.000Z")).orFail().savedAt)
		assertNotNull(decodeArticle(Fixtures.article(savedAt = "2026-05-30T10:00:00Z")).orFail().savedAt)
	}

	@Test
	fun `decodes an error body with and without a fallback action`() {
		val withFallback = SirenJson.decodeFromString(
			SirenError.serializer(),
			Fixtures.sirenError("html-too-large", "Too big", withSaveArticleFallback = true),
		)
		assertEquals("html-too-large", withFallback.properties.code)
		assertEquals("save-article", withFallback.actions?.first()?.name)

		val noFallback = SirenJson.decodeFromString(
			SirenError.serializer(),
			Fixtures.sirenError("invalid-save-html", "Invalid", withSaveArticleFallback = false),
		)
		assertNull(noFallback.actions)
	}
}
