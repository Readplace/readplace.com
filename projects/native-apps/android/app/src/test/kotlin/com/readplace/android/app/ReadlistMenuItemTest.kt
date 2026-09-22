package com.readplace.android.app

import com.readplace.android.core.Readlist
import org.junit.Assert.assertEquals
import org.junit.Test

class ReadlistMenuItemTest {
	private fun readlist(label: String, href: String) = Readlist(label = label, href = href, isCurrent = false)

	private val readlists = listOf(
		readlist("All", "/queue"),
		readlist("Work", "/queue?queue=work"),
		readlist("Later", "/queue?queue=later"),
	)

	@Test
	fun `items preserve the server's labels and order`() {
		val items = ReadlistMenuItem.items(
			readlists = readlists,
			selectedHref = null,
			mainlineHref = null,
			shareTargetHrefs = emptySet(),
		)

		assertEquals(listOf("All", "Work", "Later"), items.map { it.label })
		assertEquals(listOf("/queue", "/queue?queue=work", "/queue?queue=later"), items.map { it.href })
	}

	@Test
	fun `only the selected readlist is marked selected`() {
		val items = ReadlistMenuItem.items(
			readlists = readlists,
			selectedHref = "/queue?queue=work",
			mainlineHref = "/queue",
			shareTargetHrefs = emptySet(),
		)

		assertEquals(listOf(false, true, false), items.map { it.isSelected })
	}

	@Test
	fun `mainline and chosen extras are share targets`() {
		val items = ReadlistMenuItem.items(
			readlists = readlists,
			selectedHref = "/queue",
			mainlineHref = "/queue",
			shareTargetHrefs = setOf("/queue?queue=later"),
		)

		assertEquals(
			"mainline (root) and the chosen extra are badged; the unchosen extra is not",
			listOf(true, false, true),
			items.map { it.isShareTarget },
		)
	}

	@Test
	fun `a stale stored share href not advertised produces no item`() {
		val items = ReadlistMenuItem.items(
			readlists = readlists,
			selectedHref = "/queue",
			mainlineHref = "/queue",
			shareTargetHrefs = setOf("/queue?queue=deleted"),
		)

		assertEquals("the menu is built only from advertised readlists", 3, items.size)
		assertEquals(listOf(true, false, false), items.map { it.isShareTarget })
	}

	@Test
	fun `no readlists yields no items`() {
		assertEquals(
			emptyList<ReadlistMenuItem>(),
			ReadlistMenuItem.items(
				readlists = emptyList(),
				selectedHref = null,
				mainlineHref = null,
				shareTargetHrefs = emptySet(),
			),
		)
	}
}
