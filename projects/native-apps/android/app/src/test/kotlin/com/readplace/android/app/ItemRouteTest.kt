package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.SirenAction
import com.readplace.android.core.SirenLink
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The row maps each advertised item control to a side effect purely, so a
 * link-only control opens (rather than being dropped) and a destructive control
 * routes through a confirmation before invoking — decided here, not by a per-name
 * check in the view.
 */
class ItemRouteTest {
	private fun action(
		name: String,
		href: String? = "/queue/a1/status",
		title: String? = null,
	): SirenAction = SirenAction(name = name, href = href, method = "POST", title = title, type = null, fields = null)

	private fun control(action: SirenAction): Affordance =
		requireNotNull(Affordance.of(action)) { "an action carrying an href builds a control" }

	private fun control(link: SirenLink): Affordance =
		requireNotNull(Affordance.of(link)) { "a link carrying an href and a rel builds a control" }

	@Test
	fun `navigable link routes to open`() {
		val link = SirenLink(rel = listOf("share"), href = "/queue/a1/share", title = "Share")

		assertEquals(ItemRoute.Open(link), ItemRoute.route(affordance = control(link)))
	}

	@Test
	fun `destructive action routes to confirmation`() {
		// `delete` is destructive per the presentation mapping, so it must confirm
		// before invoking rather than acting on the tap.
		val delete = action(name = "delete", href = "/queue/a1/delete", title = "Delete")

		assertEquals(ItemRoute.ConfirmDestructive(delete), ItemRoute.route(affordance = control(delete)))
	}

	@Test
	fun `non-destructive action routes to invoke`() {
		val markRead = action(name = "update-status", title = "Mark as read")

		assertEquals(ItemRoute.Invoke(markRead), ItemRoute.route(affordance = control(markRead)))
	}
}
