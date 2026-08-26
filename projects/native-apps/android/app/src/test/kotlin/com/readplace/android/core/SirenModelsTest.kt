package com.readplace.android.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SirenModelsTest {
	private fun element(source: String): JsonElement = Json.parseToJsonElement(source)

	private fun <T : Any> present(value: T?, expected: String): T = requireNotNull(value) { "expected $expected" }

	private fun decodedEntity(source: String): SirenEntity =
		present(SirenDecoding.entity(element(source)), "the entity to decode")

	private fun decodedCollection(source: String): SirenCollection =
		present(SirenDecoding.collection(element(source)), "the collection to decode")

	private fun decodedArticle(source: String): Article =
		present(Article.of(decodedEntity(source)), "the entity to map onto an article")

	private fun message(type: String, body: String): ServerMessage =
		ServerMessage(
			type = type,
			content = ServerMessage.Content(type = ServerMessage.RENDERABLE_MEDIA_TYPE, body = body),
		)

	@Test
	fun `decodes every field the server declares on an article entity`() {
		val entity = decodedEntity(
			"""
			{
				"class": ["article"],
				"rel": ["item"],
				"properties": {
					"id": "a1",
					"url": "https://example.com/post",
					"title": "A Title",
					"siteName": "Example",
					"excerpt": "An excerpt.",
					"wordCount": 1200,
					"imageUrl": "https://example.com/img.png",
					"estimatedReadTimeMinutes": 6,
					"status": "unread",
					"savedAt": "2026-05-30T10:00:00.000Z",
					"readAt": null,
					"isRead": false,
					"messages": [
						{ "type": "warning", "content": { "type": "text/html", "body": "Still saving." } }
					]
				},
				"links": [
					{ "rel": ["read"], "href": "/queue/a1/view", "title": "Read" },
					{ "rel": ["item"], "href": "/queue/a1" }
				],
				"actions": [
					{
						"name": "update-status",
						"title": "Mark read",
						"href": "/queue/a1/status",
						"method": "POST",
						"type": "application/x-www-form-urlencoded",
						"fields": [{ "name": "status", "type": "text", "value": "read" }]
					}
				]
			}
			""",
		)

		assertEquals(listOf("article"), entity.classes)
		assertEquals(listOf("item"), entity.rel)
		val properties = present(entity.properties, "the decoded article properties")
		assertEquals("a1", properties.id)
		assertEquals("https://example.com/post", properties.url)
		assertEquals("A Title", properties.title)
		assertEquals("Example", properties.siteName)
		assertEquals("An excerpt.", properties.excerpt)
		assertEquals(1200, properties.wordCount)
		assertEquals("https://example.com/img.png", properties.imageUrl)
		assertEquals(6, properties.estimatedReadTimeMinutes)
		assertEquals("unread", properties.status)
		assertEquals("2026-05-30T10:00:00.000Z", properties.savedAt)
		assertNull("a JSON null readAt reads as absent", properties.readAt)
		assertEquals(false, properties.isRead)
		assertEquals(
			listOf("Still saving."),
			present(properties.messages, "the entity messages").map { it.content.body },
		)

		val links = present(entity.links, "the entity links")
		assertEquals(listOf(listOf("read"), listOf("item")), links.map { it.rel })
		assertEquals(listOf("/queue/a1/view", "/queue/a1"), links.map { it.href })
		assertEquals(listOf("Read", null), links.map { it.title })

		val actions = present(entity.actions, "the entity actions")
		assertEquals(1, actions.size)
		val updateStatus = actions[0]
		assertEquals("update-status", updateStatus.name)
		assertEquals("/queue/a1/status", updateStatus.href)
		assertEquals("POST", updateStatus.method)
		assertEquals("Mark read", updateStatus.title)
		assertEquals("application/x-www-form-urlencoded", updateStatus.type)
		val fields = present(updateStatus.fields, "the action fields")
		assertEquals(listOf("status"), fields.map { it.name })
		assertEquals(listOf("text"), fields.map { it.type })
		assertEquals(listOf("read"), fields.map { it.value })
	}

	@Test
	fun `an entity that is not an object does not decode`() {
		assertNull(SirenDecoding.entity(element("""["not-an-entity"]""")))
	}

	@Test
	fun `an entity whose properties are not an object decodes without properties`() {
		val entity = decodedEntity("""{ "properties": ["not-an-object"] }""")

		assertNull(entity.properties)
	}

	@Test
	fun `properties missing the id or the url do not decode`() {
		assertNull(decodedEntity("""{ "properties": { "url": "https://example.com/x" } }""").properties)
		assertNull(decodedEntity("""{ "properties": { "id": "x" } }""").properties)
	}

	@Test
	fun `a property the server sends as a non-string is read as absent`() {
		val properties = present(
			decodedEntity(
				"""
				{ "properties": {
					"id": "a1",
					"url": "https://example.com/post",
					"title": 5,
					"siteName": { "name": "Example" },
					"wordCount": { "count": 1200 },
					"isRead": ["true"]
				} }
				""",
			).properties,
			"the decoded article properties",
		)

		assertEquals("a1", properties.id)
		assertNull(properties.title)
		assertNull(properties.siteName)
		assertNull(properties.wordCount)
		assertNull(properties.isRead)
	}

	@Test
	fun `a non-array where the server should send an array carries nothing`() {
		val entity = decodedEntity(
			"""
			{ "class": "article", "rel": { "0": "item" }, "links": "/queue/a1", "actions": 7,
				"properties": { "id": "a1", "url": "https://example.com/post", "messages": "none" } }
			""",
		)

		assertNull(entity.classes)
		assertNull(entity.rel)
		assertNull(entity.links)
		assertNull(entity.actions)
		assertNull(present(entity.properties, "the decoded article properties").messages)
	}

	@Test
	fun `an array entry that is not a string is dropped from the class and rel lists`() {
		val entity = decodedEntity("""{ "class": ["article", 7], "rel": [null, "item"] }""")

		assertEquals(listOf("article"), entity.classes)
		assertEquals(listOf("item"), entity.rel)
	}

	@Test
	fun `a link or action advertised without an href is kept but unactionable`() {
		val entity = decodedEntity(
			"""
			{ "properties": { "id": "x", "url": "https://example.com/x" },
				"links": [{ "rel": ["read"], "title": "Read" }],
				"actions": [{ "name": "update-status", "method": "POST" }] }
			""",
		)

		val link = present(entity.links, "the entity links")[0]
		assertEquals(listOf("read"), link.rel)
		assertNull(link.href)
		assertEquals("Read", link.title)
		val action = present(entity.actions, "the entity actions")[0]
		assertEquals("update-status", action.name)
		assertNull(action.href)

		val article = present(Article.of(entity), "the entity to map onto an article")
		assertNull("a read link with no href leaves the row unopenable", article.readHref)
		assertEquals(emptyList<Affordance>(), article.affordances)
	}

	@Test
	fun `decodes a collection with its classes, warning, notices, entities, links and actions`() {
		val collection = decodedCollection(
			"""
			{
				"class": ["collection", "articles"],
				"properties": {
					"warning": { "code": "not-saveable", "message": "Cannot save that link." },
					"messages": [
						{ "type": "warning", "content": { "type": "text/html", "body": "Still saving." } }
					]
				},
				"entities": [{ "properties": { "id": "a1", "url": "https://example.com/a1" } }],
				"links": [
					{ "rel": ["self"], "href": "/queue" },
					{ "rel": ["next"], "href": "/queue?page=2" }
				],
				"actions": [{ "name": "save-article", "title": "Save a link", "href": "/queue", "method": "POST" }]
			}
			""",
		)

		assertEquals(listOf("collection", "articles"), collection.classes)
		val properties = present(collection.properties, "the collection properties")
		val warning = present(properties.warning, "the collection warning")
		assertEquals("not-saveable", warning.code)
		assertEquals("Cannot save that link.", warning.message)
		assertEquals(
			listOf("Still saving."),
			present(properties.messages, "the collection notices").map { it.content.body },
		)
		val rows = present(collection.entities, "the collection entities")
		assertEquals(listOf("a1"), rows.map { present(it.properties, "the row properties").id })
		assertEquals(
			listOf("/queue", "/queue?page=2"),
			present(collection.links, "the collection links").map { it.href },
		)
		assertEquals(
			listOf("save-article"),
			present(collection.actions, "the collection actions").map { it.name },
		)
	}

	@Test
	fun `a collection that is not an object does not decode`() {
		assertNull(SirenDecoding.collection(element("\"not-a-collection\"")))
	}

	@Test
	fun `a collection with absent or non-object properties carries no warning`() {
		assertNull(decodedCollection("""{ "class": ["collection"] }""").properties)
		assertNull(decodedCollection("""{ "properties": ["not-an-object"] }""").properties)
	}

	@Test
	fun `a warning the client cannot read degrades to no banner without blanking the page`() {
		val missingMessage = decodedCollection(
			"""
			{ "properties": { "warning": { "code": "not-saveable" } },
				"entities": [{ "properties": { "id": "a1", "url": "https://example.com/a1" } }] }
			""",
		)
		assertNull(present(missingMessage.properties, "the collection properties").warning)
		val rows = present(missingMessage.entities, "the collection entities")
		assertEquals(listOf("a1"), rows.map { present(it.properties, "the row properties").id })

		val notAnObject = decodedCollection("""{ "properties": { "warning": "not-saveable" } }""")
		assertNull(present(notAnObject.properties, "the collection properties").warning)
	}

	@Test
	fun `a warning without a code still surfaces its message`() {
		val collection = decodedCollection(
			"""{ "properties": { "warning": { "message": "Cannot save that link." } } }""",
		)

		val warning = present(
			present(collection.properties, "the collection properties").warning,
			"the collection warning",
		)
		assertNull(warning.code)
		assertEquals("Cannot save that link.", warning.message)
	}

	@Test
	fun `an entity the client cannot use is dropped and the valid rows still decode`() {
		val collection = decodedCollection(
			"""
			{ "entities": [
				{ "properties": { "id": "good", "url": "https://example.com/good" } },
				{ "properties": { "url": "https://example.com/no-id" } },
				"not-an-entity"
			] }
			""",
		)

		val entities = present(collection.entities, "the collection entities")
		assertEquals("an entity that is not an object is dropped at decode", 2, entities.size)
		assertEquals(
			listOf("good"),
			entities.mapNotNull { Article.of(it) }.map { it.id },
		)
	}

	@Test
	fun `a malformed action is dropped and the valid controls still decode`() {
		val collection = decodedCollection(
			"""
			{ "actions": [
				{ "name": "save-article", "title": "Save a link", "href": "/queue", "method": "POST" },
				{ "href": "/x", "method": "POST" },
				"not-an-action"
			] }
			""",
		)

		assertEquals(
			listOf("save-article"),
			present(collection.actions, "the collection actions").map { it.name },
		)
	}

	@Test
	fun `a malformed link is dropped and pagination still resolves`() {
		val collection = decodedCollection(
			"""
			{ "links": [
				{ "href": "/broken" },
				{ "rel": "next", "href": "/also-broken" },
				{ "rel": ["next"], "href": "/queue?page=2" }
			] }
			""",
		)

		assertEquals(
			listOf("/queue?page=2"),
			present(collection.links, "the collection links").map { it.href },
		)
	}

	@Test
	fun `a link that is not an object or carries no rel does not decode`() {
		assertNull(SirenDecoding.link(element("\"/queue\"")))
		assertNull(SirenDecoding.link(element("""{ "href": "/queue" }""")))
	}

	@Test
	fun `an action that is not an object or carries no name does not decode`() {
		assertNull(SirenDecoding.action(element("7")))
		assertNull(SirenDecoding.action(element("""{ "href": "/queue", "method": "POST" }""")))
	}

	@Test
	fun `a method-less action defaults to GET`() {
		val action = present(
			SirenDecoding.action(element("""{ "name": "search", "href": "/queue" }""")),
			"the action to decode",
		)

		assertEquals("GET", action.method)
		assertNull(action.title)
		assertNull(action.type)
		assertNull(action.fields)
	}

	@Test
	fun `an action whose fields are not an array carries no fields`() {
		val action = present(
			SirenDecoding.action(element("""{ "name": "search", "href": "/queue", "fields": "status" }""")),
			"the action to decode",
		)

		assertNull(action.fields)
	}

	@Test
	fun `a malformed field is dropped and the valid fields still decode`() {
		val action = present(
			SirenDecoding.action(
				element(
					"""
					{ "name": "update-status", "href": "/queue/a1/status", "method": "POST",
						"fields": [
							{ "type": "text", "value": "read" },
							"status",
							{ "name": "status", "value": "read" }
						] }
					""",
				),
			),
			"the action to decode",
		)

		assertEquals(listOf("status"), present(action.fields, "the action fields").map { it.name })
	}

	@Test
	fun `a field the server sent as a whole number posts without a trailing decimal`() {
		val field = present(
			SirenDecoding.field(element("""{ "name": "page", "type": "number", "value": 2 }""")),
			"the field to decode",
		)

		assertEquals("2", field.value)
	}

	@Test
	fun `a field the server sent as a fraction keeps its decimals`() {
		val field = present(
			SirenDecoding.field(element("""{ "name": "ratio", "type": "number", "value": 1.5 }""")),
			"the field to decode",
		)

		assertEquals("1.5", field.value)
	}

	@Test
	fun `a field value that is not a finite number is never coerced to a whole number`() {
		val field = present(
			SirenDecoding.field(
				buildJsonObject {
					put("name", "ratio")
					put("value", Double.POSITIVE_INFINITY)
				},
			),
			"the field to decode",
		)

		assertEquals("Infinity", field.value)
	}

	@Test
	fun `a field value the server did not send as a string or a number is absent`() {
		assertNull(
			present(
				SirenDecoding.field(element("""{ "name": "url", "type": "url" }""")),
				"the field to decode",
			).value,
		)
		assertNull(
			present(
				SirenDecoding.field(element("""{ "name": "url", "value": { "href": "/x" } }""")),
				"the field to decode",
			).value,
		)
		assertNull(
			present(
				SirenDecoding.field(element("""{ "name": "url", "value": true }""")),
				"the field to decode",
			).value,
		)
	}

	@Test
	fun `a field that is not an object or carries no name does not decode`() {
		assertNull(SirenDecoding.field(element("\"status\"")))
		assertNull(SirenDecoding.field(element("""{ "type": "text", "value": "read" }""")))
	}

	@Test
	fun `decodes an error body with its code, message and server messages`() {
		val body = present(
			SirenDecoding.errorBody(
				element(
					"""
					{ "properties": {
						"code": "invalid-save-content",
						"message": "Bad",
						"messages": [
							{ "type": "error", "content": { "type": "text/html", "body": "Email us." } },
							{ "type": "error" }
						]
					} }
					""",
				),
			),
			"the error body to decode",
		)

		assertEquals("invalid-save-content", body.properties.code)
		assertEquals("Bad", body.properties.message)
		assertEquals(
			listOf("Email us."),
			present(body.properties.messages, "the error messages").map { it.content.body },
		)
	}

	@Test
	fun `an error body without a properties object does not decode`() {
		assertNull(SirenDecoding.errorBody(element("\"boom\"")))
		assertNull(SirenDecoding.errorBody(element("""{ "class": ["error"] }""")))
		assertNull(SirenDecoding.errorBody(element("""{ "properties": "boom" }""")))
	}

	@Test
	fun `an error body without messages carries none`() {
		val body = present(
			SirenDecoding.errorBody(element("""{ "properties": { "code": "boom" } }""")),
			"the error body to decode",
		)

		assertEquals("boom", body.properties.code)
		assertNull(body.properties.message)
		assertNull(body.properties.messages)
	}

	@Test
	fun `a message missing any part of its content does not decode`() {
		assertNull(SirenDecoding.serverMessage(element("\"warning\"")))
		assertNull(
			SirenDecoding.serverMessage(
				element("""{ "content": { "type": "text/html", "body": "x" } }"""),
			),
		)
		assertNull(SirenDecoding.serverMessage(element("""{ "type": "warning", "content": "x" }""")))
		assertNull(
			SirenDecoding.serverMessage(element("""{ "type": "warning", "content": { "body": "x" } }""")),
		)
		assertNull(
			SirenDecoding.serverMessage(
				element("""{ "type": "warning", "content": { "type": "text/html" } }"""),
			),
		)
	}

	@Test
	fun `decodes a server message with its type and content`() {
		val decoded = present(
			SirenDecoding.serverMessage(
				element("""{ "type": "error", "content": { "type": "text/html", "body": "Email us." } }"""),
			),
			"the server message to decode",
		)

		assertEquals("error", decoded.type)
		assertEquals("text/html", decoded.content.type)
		assertEquals("Email us.", decoded.content.body)
	}

	@Test
	fun `an error message presents as an error and every other type as a warning`() {
		assertEquals(ServerMessage.Kind.ERROR, message(type = "error", body = "x").kind)
		assertEquals(ServerMessage.Kind.WARNING, message(type = "warning", body = "x").kind)
		assertEquals(ServerMessage.Kind.WARNING, message(type = "future-severity", body = "x").kind)
	}

	@Test
	fun `only the html media type is renderable`() {
		assertEquals("text/html", ServerMessage.RENDERABLE_MEDIA_TYPE)
		assertTrue(message(type = "warning", body = "x").isRenderable)
		assertFalse(
			ServerMessage(
				type = "warning",
				content = ServerMessage.Content(type = "text/plain", body = "x"),
			).isRenderable,
		)
	}

	@Test
	fun `plain text strips markup and trims the surrounding whitespace`() {
		val notice = message(
			type = "warning",
			body = "  <p>Email <a href=\"mailto:a@b.com\">a@b.com</a> now</p>  ",
		)

		assertEquals("Email a@b.com now", notice.plainText)
	}

	@Test
	fun `plain text decodes the named references`() {
		val notice = message(
			type = "warning",
			body = "Tom &amp; Jerry said &quot;hi&quot; &lt;here&gt; it&apos;s fine",
		)

		assertEquals("Tom & Jerry said \"hi\" <here> it's fine", notice.plainText)
	}

	@Test
	fun `plain text decodes decimal and hexadecimal references`() {
		val notice = message(type = "warning", body = "&#39;dec&#39; &#x27;hex&#x27; &#X27;upperhex&#X27; &#38;")

		assertEquals("'dec' 'hex' 'upperhex' &", notice.plainText)
	}

	@Test
	fun `plain text decodes an escaped reference exactly once`() {
		val notice = message(type = "warning", body = "literal &amp;lt; entity")

		assertEquals(
			"a single left-to-right pass never re-reads the text it just produced",
			"literal &lt; entity",
			notice.plainText,
		)
	}

	@Test
	fun `plain text keeps an escaped tag as text rather than stripping it as markup`() {
		val notice = message(type = "warning", body = "&lt;b&gt;bold&lt;/b&gt;")

		assertEquals("<b>bold</b>", notice.plainText)
	}

	@Test
	fun `plain text leaves a bare ampersand and an unresolvable reference verbatim`() {
		val notice = message(type = "warning", body = "fish & chips, &unknown; &#zz; &; &notclosed")

		assertEquals("fish & chips, &unknown; &#zz; &; &notclosed", notice.plainText)
	}

	@Test
	fun `plain text leaves an out of range code point verbatim`() {
		val notice = message(type = "warning", body = "&#1114112; and &#-1; and &#x110000;")

		assertEquals("&#1114112; and &#-1; and &#x110000;", notice.plainText)
	}

	@Test
	fun `an entity with no properties yields no article`() {
		assertNull(Article.of(decodedEntity("""{ "class": ["article"], "links": [] }""")))
	}

	@Test
	fun `the article falls back to the url when the server sent no title or an empty one`() {
		assertEquals(
			"https://example.com/x",
			decodedArticle("""{ "properties": { "id": "x", "url": "https://example.com/x" } }""").title,
		)
		assertEquals(
			"https://example.com/x",
			decodedArticle(
				"""{ "properties": { "id": "x", "url": "https://example.com/x", "title": "" } }""",
			).title,
		)
		assertEquals(
			"A Title",
			decodedArticle(
				"""{ "properties": { "id": "x", "url": "https://example.com/x", "title": "A Title" } }""",
			).title,
		)
	}

	@Test
	fun `the server explicit read state wins over the status vocabulary`() {
		assertFalse(
			decodedArticle(
				"""
				{ "properties": { "id": "x", "url": "https://example.com/x", "status": "read",
					"readAt": "2026-05-31T09:00:00.000Z", "isRead": false } }
				""",
			).isRead,
		)
		assertTrue(
			decodedArticle(
				"""
				{ "properties": { "id": "x", "url": "https://example.com/x", "status": "unread", "isRead": true } }
				""",
			).isRead,
		)
	}

	@Test
	fun `read state is derived from the status vocabulary when the server omits it`() {
		assertTrue(
			decodedArticle(
				"""{ "properties": { "id": "x", "url": "https://example.com/x", "status": "read" } }""",
			).isRead,
		)
		assertTrue(
			decodedArticle(
				"""
				{ "properties": { "id": "x", "url": "https://example.com/x", "status": "unread",
					"readAt": "2026-05-31T09:00:00.000Z" } }
				""",
			).isRead,
		)
		assertFalse(
			decodedArticle(
				"""{ "properties": { "id": "x", "url": "https://example.com/x", "status": "unread" } }""",
			).isRead,
		)
	}

	@Test
	fun `savedAt parses to an exact instant and an unparseable one leaves the row undated`() {
		val saved = decodedArticle(
			"""
			{ "properties": { "id": "x", "url": "https://example.com/x", "savedAt": "2026-05-30T10:00:00.000Z" } }
			""",
		)
		assertEquals(1780135200000L, present(saved.savedAt, "the parsed savedAt instant").toEpochMilli())

		assertNull(
			decodedArticle(
				"""{ "properties": { "id": "x", "url": "https://example.com/x", "savedAt": "yesterday" } }""",
			).savedAt,
		)
		assertNull(
			decodedArticle("""{ "properties": { "id": "x", "url": "https://example.com/x" } }""").savedAt,
		)
	}

	@Test
	fun `the row tap target comes from the read link`() {
		assertEquals(
			"/queue/x/view",
			decodedArticle(
				"""
				{ "properties": { "id": "x", "url": "https://example.com/x" },
					"links": [{ "rel": ["item"], "href": "/queue/x" }, { "rel": ["read"], "href": "/queue/x/view" }] }
				""",
			).readHref,
		)
		assertNull(
			decodedArticle(
				"""
				{ "properties": { "id": "x", "url": "https://example.com/x" },
					"links": [{ "rel": ["item"], "href": "/queue/x" }] }
				""",
			).readHref,
		)
	}

	@Test
	fun `an article the server advertised no controls on carries none`() {
		val article = decodedArticle("""{ "properties": { "id": "x", "url": "https://example.com/x" } }""")

		assertEquals(emptyList<SirenAction>(), article.actions)
		assertEquals(emptyList<SirenLink>(), article.links)
		assertEquals(emptyList<Affordance>(), article.affordances)
		assertNull(article.readHref)
		assertNull(article.siteName)
		assertNull(article.excerpt)
		assertNull(article.imageUrl)
		assertNull(article.readTimeMinutes)
	}

	@Test
	fun `the article carries the rest of its display fields from the entity`() {
		val article = decodedArticle(
			"""
			{ "properties": { "id": "a1", "url": "https://example.com/post", "title": "A Title",
				"siteName": "Example", "excerpt": "An excerpt.", "imageUrl": "https://example.com/img.png",
				"estimatedReadTimeMinutes": 6 } }
			""",
		)

		assertEquals("a1", article.id)
		assertEquals("https://example.com/post", article.url)
		assertEquals("A Title", article.title)
		assertEquals("Example", article.siteName)
		assertEquals("An excerpt.", article.excerpt)
		assertEquals("https://example.com/img.png", article.imageUrl)
		assertEquals(6, article.readTimeMinutes)
	}

	@Test
	fun `the article controls iterate the advertised actions in wire order`() {
		val article = decodedArticle(
			"""
			{ "properties": { "id": "x", "url": "https://example.com/x" },
				"actions": [
					{ "name": "update-status", "title": "Mark read", "href": "/queue/x/status", "method": "POST" },
					{ "name": "delete", "title": "Delete", "href": "/queue/x/delete", "method": "POST" },
					{ "name": "archive", "href": "/queue/x/archive", "method": "POST" },
					{ "name": "annotate", "method": "POST" }
				] }
			""",
		)

		assertEquals(
			listOf("update-status", "delete", "archive"),
			article.affordances.map { it.token },
		)
		assertEquals(listOf("Mark read", "Delete", "Archive"), article.affordances.map { it.label })
		assertEquals(
			listOf("action:update-status", "action:delete", "action:archive"),
			article.affordances.map { it.id },
		)
	}

	@Test
	fun `a row re-read unchanged is the same value and an enriched row is not`() {
		val stub = """
			{ "properties": { "id": "a1", "url": "https://example.com/post",
				"title": "Article from example.com", "excerpt": "Saved from example.com." } }
		"""
		val enriched = """
			{ "properties": { "id": "a1", "url": "https://example.com/post",
				"title": "The Real Headline", "excerpt": "The real excerpt." } }
		"""

		assertEquals(decodedArticle(stub), decodedArticle(stub))
		assertEquals(decodedArticle(stub).id, decodedArticle(enriched).id)
		assertNotEquals(decodedArticle(stub), decodedArticle(enriched))
	}

	@Test
	fun `a control from an action carries its own invocation, token, label and id`() {
		val action = SirenAction(
			name = "update-status",
			href = "/queue/x/status",
			method = "POST",
			title = "Mark read",
			type = null,
			fields = null,
		)

		val affordance = present(Affordance.of(action), "a control for the action")
		assertEquals(Affordance.Invocation.OfAction(action), affordance.invocation)
		assertEquals(action, affordance.action)
		assertNull(affordance.link)
		assertEquals("update-status", affordance.token)
		assertEquals("Mark read", affordance.label)
		assertEquals("action:update-status", affordance.id)
	}

	@Test
	fun `a title-less action renders a humanized token`() {
		val affordance = present(
			Affordance.of(
				SirenAction(
					name = "update-status",
					href = "/queue/x/status",
					method = "POST",
					title = null,
					type = null,
					fields = null,
				),
			),
			"a control for the action",
		)

		assertEquals("Update Status", affordance.label)
	}

	@Test
	fun `an action without an href is not a control`() {
		assertNull(
			Affordance.of(
				SirenAction(
					name = "update-status",
					href = null,
					method = "POST",
					title = "Mark read",
					type = null,
					fields = null,
				),
			),
		)
	}

	@Test
	fun `a control from a link carries its own invocation, token, label and id`() {
		val link = SirenLink(rel = listOf("share", "alternate"), href = "/queue/x/share", title = "Share")

		val affordance = present(Affordance.of(link), "a control for the link")
		assertEquals(Affordance.Invocation.OfLink(link), affordance.invocation)
		assertEquals(link, affordance.link)
		assertNull(affordance.action)
		assertEquals("share", affordance.token)
		assertEquals("Share", affordance.label)
		assertEquals("link:share", affordance.id)
	}

	@Test
	fun `a title-less link renders a humanized rel`() {
		val affordance = present(
			Affordance.of(SirenLink(rel = listOf("add-links-help"), href = "/help/add-links", title = null)),
			"a control for the link",
		)

		assertEquals("Add Links Help", affordance.label)
	}

	@Test
	fun `a link without an href or without a rel is not a control`() {
		assertNull(Affordance.of(SirenLink(rel = listOf("share"), href = null, title = "Share")))
		assertNull(Affordance.of(SirenLink(rel = emptyList(), href = "/queue/x/share", title = "Share")))
	}

	@Test
	fun `humanizing a token splits on dashes and underscores and drops the empty segments`() {
		assertEquals("Mark Read", Affordance.humanize("mark-read"))
		assertEquals("Archive Now", Affordance.humanize("archive_now"))
		assertEquals("Mark Read Now", Affordance.humanize("-mark--read_now_"))
		assertEquals("Save", Affordance.humanize("save"))
		assertEquals("", Affordance.humanize(""))
	}

	@Test
	fun `a timestamp parses to an exact instant and anything else does not parse`() {
		assertEquals(
			1780135200000L,
			present(SirenDate.parse("2026-05-30T10:00:00Z"), "the parsed instant").toEpochMilli(),
		)
		assertEquals(
			1780135200123L,
			present(SirenDate.parse("2026-05-30T10:00:00.123Z"), "the parsed instant").toEpochMilli(),
		)
		assertNull(SirenDate.parse("not-a-date"))
		assertNull(SirenDate.parse(""))
	}

	@Test
	fun `a scheme-less href resolves against the server origin`() {
		assertEquals(
			"https://readplace.com/queue/a1/view",
			Href.resolve("/queue/a1/view", "https://readplace.com"),
		)
		assertEquals(
			"https://readplace.com/queue/a1/view",
			Href.resolve("queue/a1/view", "https://readplace.com"),
		)
		assertEquals(
			"https://readplace.com/queue/a b",
			Href.resolve("/queue/a b", "https://readplace.com"),
		)
	}

	@Test
	fun `an href in a scheme the client speaks is used as the server sent it`() {
		assertEquals(
			"https://readplace.com/queue",
			Href.resolve("https://readplace.com/queue", "https://readplace.com"),
		)
		assertEquals(
			"http://readplace.com/queue",
			Href.resolve("http://readplace.com/queue", "https://readplace.com"),
		)
		assertEquals(
			"HTTPS://readplace.com/queue",
			Href.resolve("HTTPS://readplace.com/queue", "https://readplace.com"),
		)
		assertEquals(
			"readplace://oauth-callback/android",
			Href.resolve("readplace://oauth-callback/android", "https://readplace.com"),
		)
	}

	@Test
	fun `an href in a scheme the client does not speak is unactionable`() {
		assertNull(Href.resolve("mailto:readplace@readplace.com", "https://readplace.com"))
		assertNull(Href.resolve("javascript:alert(1)", "https://readplace.com"))
	}

	@Test
	fun `appending a query item preserves whatever query the url already carried`() {
		assertEquals(
			"https://readplace.com/queue/a1/view?platform=android",
			Href.appending("https://readplace.com/queue/a1/view", "platform", "android"),
		)
		assertEquals(
			"https://readplace.com/queue/a1/view?poll=2&platform=android",
			Href.appending("https://readplace.com/queue/a1/view?poll=2", "platform", "android"),
		)
		assertEquals(
			"https://readplace.com/queue/a1/view?platform=android",
			Href.appending("https://readplace.com/queue/a1/view?", "platform", "android"),
		)
		assertEquals(
			"https://readplace.com/queue/a1/view?poll=2&platform=android",
			Href.appending("https://readplace.com/queue/a1/view?poll=2&", "platform", "android"),
		)
	}

	@Test
	fun `an appended query item is percent encoded`() {
		assertEquals(
			"https://readplace.com/queue?redirect+uri=a+b%26c%3Dd",
			Href.appending("https://readplace.com/queue", "redirect uri", "a b&c=d"),
		)
	}

	@Test
	fun `the essence of a content type drops its parameters and its casing`() {
		assertEquals(
			"application/vnd.siren+json",
			MediaType.essenceOf("application/vnd.siren+json; charset=UTF-8"),
		)
		assertEquals("application/json", MediaType.essenceOf("  APPLICATION/JSON  "))
		assertNull(MediaType.essenceOf(null))
	}

	@Test
	fun `a content type matches on its essence alone`() {
		assertTrue(MediaType.matches("Application/JSON; charset=utf-8", "application/json"))
		assertFalse(MediaType.matches("text/html; charset=utf-8", "application/json"))
		assertFalse(MediaType.matches(null, "application/json"))
	}
}
