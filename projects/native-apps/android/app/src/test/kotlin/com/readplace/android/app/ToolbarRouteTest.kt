package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The toolbar maps each advertised control to a side effect without gating which
 * controls exist: the `add-links-help` link presents the native help sheet, any
 * other navigable link opens, and any action is invoked through the generic
 * invoker — never opened as a GET web view of its href.
 */
class ToolbarRouteTest {
	@Test
	fun `routes a navigable link to open`() {
		val link = SirenLink(rel = listOf("save"), href = "/save", title = "Save a link")
		val affordance = requireNotNull(Affordance.of(link))

		assertEquals(ToolbarRoute.Open(link), ToolbarRoute.route(affordance))
	}

	@Test
	fun `routes the add-links-help link to the native help sheet`() {
		// The `add-links-help` link is a help affordance the client presents as its own
		// native instructions sheet, not browsed to as a page — so which sheet a control
		// presents is decided here, never by a name check in the view.
		val link = SirenLink(rel = listOf("add-links-help"), href = "/import", title = "Import links")
		val affordance = requireNotNull(Affordance.of(link))

		assertEquals(ToolbarRoute.PresentAddLinksHelp, ToolbarRoute.route(affordance))
	}

	@Test
	fun `routes a non-save action to the generic invoker`() {
		// A bare-invokable collection action is submitted through the generic invoker,
		// honouring its own method/type/fields — never opened as a GET web view of its
		// href, which would discard the action's invocation and silently turn a
		// capability into navigation.
		val purge = SirenAction(
			name = "purge-all",
			href = "/queue/purge",
			method = "POST",
			title = "Purge",
			type = null,
			fields = null,
		)
		val affordance = requireNotNull(Affordance.of(purge))

		assertEquals(ToolbarRoute.Invoke(purge), ToolbarRoute.route(affordance))
	}
}
