package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.Article
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenField
import com.readplace.android.core.SirenLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Presentation is 100% a client concern: each known wire token maps to the
 * client's own icon/tint/role, and an unknown token falls back to a neutral
 * default so an affordance the client has never seen still renders rather than
 * vanishing. The token is never used as a style string verbatim.
 */
class AffordancePresentationTest {
	@Test
	fun `add-links-help maps to a neutral add control in the toolbar`() {
		// The reading list's + control is a client-injected add-links-help affordance:
		// a neutral add (+) glyph that opens the Share help sheet.
		val presentation = AffordancePresentation.of("add-links-help")
		assertEquals(AffordanceIcon.PLUS, presentation.icon)
		assertEquals(AffordanceTint.NEUTRAL, presentation.tint)
		assertFalse(presentation.isDestructive)
		assertFalse(presentation.removesItem)
		assertTrue(presentation.isToolbarControl)
	}

	@Test
	fun `machine-only actions are not toolbar controls`() {
		// The app can't capture a page from the toolbar, so save-content is reached
		// only through the system share sheet; create-session is invoked bespoke to
		// mint the reader session. Neither renders in the toolbar.
		val saveContent = AffordancePresentation.of("save-content")
		assertEquals(AffordanceIcon.PLUS, saveContent.icon)
		val createSession = AffordancePresentation.of("create-session")
		assertEquals(AffordanceIcon.KEY, createSession.icon)
		for (presentation in listOf(saveContent, createSession)) {
			assertFalse(presentation.isToolbarControl)
			assertTrue(presentation.isRecognizedToken)
			assertFalse(presentation.removesItem)
			assertFalse(presentation.isDestructive)
			assertEquals(AffordanceTint.NEUTRAL, presentation.tint)
		}
	}

	@Test
	fun `update-status maps to a read control whose removal is transition dependent`() {
		val presentation = AffordancePresentation.of("update-status")
		assertEquals(AffordanceIcon.CHECKMARK_CIRCLE, presentation.icon)
		assertEquals(AffordanceTint.SUCCESS, presentation.tint)
		assertFalse(presentation.isDestructive)
		// update-status is a server toggle, so whether it removes the row depends on
		// the field value, not the token.
		assertFalse(presentation.removesItem)
		assertTrue(presentation.isToolbarControl)
	}

	@Test
	fun `delete maps to a destructive trash control that removes the item`() {
		val presentation = AffordancePresentation.of("delete")
		assertEquals(AffordanceIcon.TRASH, presentation.icon)
		assertEquals(AffordanceTint.DESTRUCTIVE, presentation.tint)
		// delete is irreversible, so the View confirms before invoking.
		assertTrue(presentation.isDestructive)
		assertTrue(presentation.removesItem)
		assertTrue(presentation.isToolbarControl)
	}

	@Test
	fun `search maps to a neutral magnifier control`() {
		val presentation = AffordancePresentation.of("search")
		assertEquals(AffordanceIcon.MAGNIFYING_GLASS, presentation.icon)
		assertEquals(AffordanceTint.NEUTRAL, presentation.tint)
		assertFalse(presentation.isDestructive)
		assertFalse(presentation.removesItem)
		assertTrue(presentation.isToolbarControl)
	}

	@Test
	fun `account maps to a neutral person control in the toolbar`() {
		// The account link opens the server's /account page in the web sheet; a person
		// glyph, not the generic unknown-token ellipsis, tells the user where their
		// account (and its deletion) lives.
		val presentation = AffordancePresentation.of("account")
		assertEquals(AffordanceIcon.PERSON_CIRCLE, presentation.icon)
		assertEquals(AffordanceTint.NEUTRAL, presentation.tint)
		assertFalse(presentation.isDestructive)
		assertFalse(presentation.removesItem)
		assertTrue(presentation.isToolbarControl)
	}

	@Test
	fun `structural link rels are never toolbar controls`() {
		// The client follows self/root/prev/next/item itself for pagination, identity,
		// and item resolution; they are never rendered as user controls. `item` in
		// particular: an `item` collection link resolves a member, not a tappable
		// affordance, so it must be excluded structurally like the rest.
		assertEquals(setOf("self", "root", "prev", "next", "item"), Affordance.structuralRels)
		for (rel in Affordance.structuralRels) {
			val presentation = AffordancePresentation.of(rel)
			assertFalse(presentation.isToolbarControl)
			assertTrue(presentation.isRecognizedToken)
			assertEquals(AffordanceIcon.ELLIPSIS_CIRCLE, presentation.icon)
			assertEquals(AffordanceTint.NEUTRAL, presentation.tint)
			assertFalse(presentation.isDestructive)
			assertFalse(presentation.removesItem)
		}
	}

	@Test
	fun `an unknown token falls back to a neutral default that still renders`() {
		val presentation = AffordancePresentation.of("some-future-action")
		assertEquals(AffordanceIcon.ELLIPSIS_CIRCLE, presentation.icon)
		assertEquals(AffordanceTint.NEUTRAL, presentation.tint)
		assertFalse(presentation.isDestructive)
		assertFalse(presentation.removesItem)
		assertFalse(presentation.isRecognizedToken)
		// A newly-advertised affordance still renders in the toolbar rather than
		// vanishing.
		assertTrue(presentation.isToolbarControl)
	}

	@Test
	fun `an affordance derives its presentation from its own wire token`() {
		val delete = affordance(action(name = "delete", href = "/queue/a1/delete"))
		assertEquals(AffordancePresentation.of("delete"), delete.presentation)
	}

	// region Transition-aware removal

	@Test
	fun `update-status removes the row when its status value moves the item to read`() {
		// The server toggle on an unread item targets "read", which leaves the
		// unread-only list, so the row is dropped optimistically.
		val toRead = affordance(action(name = "update-status", fields = listOf(statusField("read"))))
		assertTrue(toRead.removesItemFromUnreadList)
	}

	@Test
	fun `update-status keeps the row when its status value toggles back to unread`() {
		// The same action on an already-read item targets "unread"; the row stays in
		// the unread-only list, so nothing is removed — the next load reconciles it.
		val toUnread = affordance(action(name = "update-status", fields = listOf(statusField("unread"))))
		assertFalse(toUnread.removesItemFromUnreadList)
	}

	@Test
	fun `delete always removes the row regardless of fields`() {
		val delete = affordance(action(name = "delete", href = "/queue/a1/delete"))
		assertTrue(delete.removesItemFromUnreadList)
	}

	@Test
	fun `an unrelated action does not remove the row`() {
		val other = affordance(action(name = "view-original", href = "/queue/a1/original"))
		assertFalse(other.removesItemFromUnreadList)
	}

	@Test
	fun `an action whose fields carry no status does not remove the row`() {
		val url = field(name = "url", value = "https://a.example")
		val save = affordance(action(name = "save-article", href = "/queue", fields = listOf(url)))
		assertFalse(save.removesItemFromUnreadList)
	}

	@Test
	fun `a navigable link never removes a row`() {
		val link = affordance(SirenLink(rel = listOf("save"), href = "/save", title = null))
		assertFalse(link.removesItemFromUnreadList)
	}

	// endregion

	// region Bare-control invokability

	@Test
	fun `a field-requiring action with no server value is not a bare toolbar control`() {
		// `search` declares fields the server did not pre-fill and the app has no query
		// UI, so it is not invokable from a bare control and must not be surfaced.
		val search = affordance(
			action(
				name = "search",
				href = "/queue",
				fields = listOf(statusField(null), field(name = "url", value = null)),
			),
		)
		assertFalse(search.isInvokableByBareControl)
		assertFalse(search.isToolbarControl)
	}

	@Test
	fun `save-article is not a bare toolbar control because its url field has no server value`() {
		// save-article declares a url field with no server value, and the app does not
		// prompt for it from the toolbar (saving a URL is a share-sheet capability), so
		// it is not invokable from a bare control and must not be surfaced.
		val save = affordance(
			action(name = "save-article", href = "/queue", fields = listOf(field(name = "url", value = null))),
		)
		assertFalse(save.isInvokableByBareControl)
		assertFalse(save.isToolbarControl)
	}

	@Test
	fun `an action whose fields all carry a server value is bare-invokable`() {
		val toRead = affordance(action(name = "update-status", fields = listOf(statusField("read"))))
		assertTrue(toRead.isInvokableByBareControl)
		assertTrue(toRead.isToolbarControl)
	}

	@Test
	fun `an action declaring an empty field list is bare-invokable`() {
		val empty = affordance(action(name = "update-status", fields = emptyList()))
		assertTrue(empty.isInvokableByBareControl)
		assertTrue(empty.isToolbarControl)
	}

	@Test
	fun `a field-less action and a link are bare-invokable`() {
		val fieldLess = affordance(action(name = "some-future-action", href = "/queue/go"))
		assertTrue(fieldLess.isInvokableByBareControl)
		// A navigable link carries no fields, so a bare control can open it.
		val link = affordance(SirenLink(rel = listOf("save"), href = "/save", title = null))
		assertTrue(link.isInvokableByBareControl)
	}

	// endregion

	// region Machine-capability gate (title-less unknown ⇒ not a toolbar control)

	@Test
	fun `an unrecognized title-less action is a machine capability not a toolbar control`() {
		// A future field-less action the client doesn't recognise and the server didn't
		// title — exactly how `create-session` is advertised today — is a machine
		// capability the client invokes bespoke, so it must never surface as a mystery
		// toolbar button on a shipped build.
		val machine = affordance(action(name = "mint-token", href = "/mint"))
		// It is field-less, so the bare-control check alone would admit it.
		assertTrue(machine.isInvokableByBareControl)
		assertFalse(machine.isToolbarControl)
	}

	@Test
	fun `an unrecognized action titled with an empty string stays a machine capability`() {
		val blank = affordance(action(name = "mint-token", href = "/mint", title = ""))
		assertFalse(blank.isToolbarControl)
	}

	@Test
	fun `an unrecognized but titled action still renders as a toolbar control`() {
		// The server signals "this is a user control" by giving the affordance a
		// `title`; a titled unknown action still renders (with the generic look), so a
		// genuinely new user affordance is never dropped.
		val titled = affordance(action(name = "purge-all", href = "/queue/purge", title = "Purge"))
		assertTrue(titled.isToolbarControl)
	}

	@Test
	fun `an unrecognized title-less link is not a toolbar control`() {
		// The same machine-capability rule applies to a link the client doesn't
		// recognise: without a server title it is not surfaced as a control.
		val link = affordance(SirenLink(rel = listOf("share"), href = "/share", title = null))
		assertFalse(link.isToolbarControl)
	}

	@Test
	fun `an unrecognized titled link renders as a toolbar control`() {
		val link = affordance(SirenLink(rel = listOf("share"), href = "/share", title = "Share"))
		assertTrue(link.isToolbarControl)
	}

	@Test
	fun `a machine-only action is not a toolbar control even when the server titles it`() {
		// save-content is excluded by the token itself, so a server title cannot
		// promote a capture-only save into a toolbar button.
		val titled = affordance(action(name = "save-content", href = "/queue/content", title = "Save page"))
		assertFalse(titled.isToolbarControl)
	}

	// endregion

	// region Structural-rel safety across every rel, not just the first

	@Test
	fun `a link is excluded when any of its rels is structural not just the first`() {
		// A multi-rel link whose first rel is presentational but which also carries a
		// structural rel (`["alternate", "next"]`) must not render as a control while
		// the client is also following it for pagination — every rel is checked, not
		// just the presentation token.
		val multiRel = affordance(
			SirenLink(rel = listOf("alternate", "next"), href = "/queue?page=2", title = "More"),
		)
		assertTrue(multiRel.isStructuralLink)
		assertFalse(multiRel.isToolbarControl)
	}

	@Test
	fun `a link with no structural rel stays a candidate control`() {
		val semantic = affordance(
			SirenLink(rel = listOf("alternate", "share"), href = "/share", title = "Share"),
		)
		assertFalse(semantic.isStructuralLink)
		assertTrue(semantic.isToolbarControl)
	}

	@Test
	fun `an action is never a structural link`() {
		val update = affordance(action(name = "update-status", fields = listOf(statusField("read"))))
		assertFalse(update.isStructuralLink)
	}

	// endregion

	// region Row controls

	@Test
	fun `a semantic link is a row control while structural and read links are not`() {
		val share = affordance(SirenLink(rel = listOf("share"), href = "/share", title = "Share"))
		assertTrue(share.isSemanticControlLink)
		val self = affordance(SirenLink(rel = listOf("self"), href = "/queue/a1", title = null))
		assertFalse(self.isSemanticControlLink)
		// `read` is already the row's primary tap target, so it is not rendered twice.
		val read = affordance(SirenLink(rel = listOf("read"), href = "/queue/a1/read", title = "Read"))
		assertFalse(read.isSemanticControlLink)
	}

	@Test
	fun `an action is never a semantic control link`() {
		val update = affordance(action(name = "update-status", fields = listOf(statusField("read"))))
		assertFalse(update.isSemanticControlLink)
	}

	@Test
	fun `a row surfaces every invokable action plus every semantic link`() {
		val row = article(
			actions = listOf(
				action(name = "update-status", fields = listOf(statusField("read"))),
				action(name = "delete", href = "/queue/a1/delete"),
				action(name = "search", href = "/queue", fields = listOf(field(name = "url", value = null))),
			),
			links = listOf(
				SirenLink(rel = listOf("self"), href = "/queue/a1", title = null),
				SirenLink(rel = listOf("read"), href = "/queue/a1/read", title = null),
				SirenLink(rel = listOf("share"), href = "/queue/a1/share", title = "Share"),
			),
		)
		assertEquals(
			listOf("action:update-status", "action:delete", "link:share"),
			row.rowControls.map { it.id },
		)
	}

	// endregion

	@Test
	fun `only the add-links-help rel routes to the in-app instructions sheet`() {
		assertTrue(Affordance.isAddLinksHelp("add-links-help"))
		assertFalse(Affordance.isAddLinksHelp("account"))
	}

	@Test
	fun `only the account control renders its title beside its glyph`() {
		// The account page is the only route to deleting an account, and store review
		// requires that route to be findable — a bare person glyph names nothing. Every
		// other toolbar control stays icon-only so the bar fits.
		assertTrue(AffordancePresentation.of("account").showsTitle)
		assertFalse(AffordancePresentation.of("search").showsTitle)
		assertFalse(AffordancePresentation.of("add-links-help").showsTitle)
		assertFalse(AffordancePresentation.of("update-status").showsTitle)
		assertFalse(AffordancePresentation.of("delete").showsTitle)
		assertFalse(AffordancePresentation.of("save-content").showsTitle)
		assertFalse(AffordancePresentation.of("create-session").showsTitle)
		assertFalse(AffordancePresentation.of("self").showsTitle)
		assertFalse(AffordancePresentation.of("a-token-shipped-after-this-build").showsTitle)
	}

	private fun action(
		name: String,
		href: String? = "/queue/a1/status",
		title: String? = null,
		fields: List<SirenField>? = null,
	): SirenAction =
		SirenAction(name = name, href = href, method = "POST", title = title, type = null, fields = fields)

	private fun field(name: String, value: String?): SirenField =
		SirenField(name = name, type = "text", value = value)

	private fun statusField(value: String?): SirenField = field(name = "status", value = value)

	private fun affordance(action: SirenAction): Affordance = requireNotNull(Affordance.of(action))

	private fun affordance(link: SirenLink): Affordance = requireNotNull(Affordance.of(link))

	private fun article(actions: List<SirenAction>, links: List<SirenLink>): Article = Article(
		id = "a1",
		url = "https://example.com/a",
		title = "An article",
		siteName = null,
		excerpt = null,
		imageUrl = null,
		readTimeMinutes = null,
		isRead = false,
		savedAt = null,
		actions = actions,
		links = links,
		readHref = links.firstOrNull { it.rel.contains("read") }?.href,
	)
}
