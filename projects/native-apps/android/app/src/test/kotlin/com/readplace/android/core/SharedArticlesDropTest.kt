package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedArticlesDropTest {
	private fun readlist(label: String, href: String) = Readlist(label = label, href = href, isCurrent = false)

	@Test
	fun `a readlist at the mainline root is the locked always row`() {
		val drop = SharedArticlesDrop.of(
			readlist("All", "/queue"),
			mainlineHref = "/queue",
			tickedHrefs = emptySet(),
		)

		assertEquals(SharedArticlesDrop.Always("All"), drop)
		assertNull("mainline has no toggleable choice", drop.choice)
		assertTrue("mainline always shows its tick", drop.showsTick)
		assertEquals("All", drop.label)
	}

	@Test
	fun `a ticked extra shows its tick and carries the readlist`() {
		val work = readlist("Work", "/queue?queue=work")

		val drop = SharedArticlesDrop.of(work, mainlineHref = "/queue", tickedHrefs = setOf("/queue?queue=work"))

		assertEquals(SharedArticlesDrop.Ticked(work), drop)
		assertEquals(work, drop.choice)
		assertTrue(drop.showsTick)
		assertEquals("Work", drop.label)
	}

	@Test
	fun `an unticked extra shows no tick`() {
		val work = readlist("Work", "/queue?queue=work")

		val drop = SharedArticlesDrop.of(work, mainlineHref = "/queue", tickedHrefs = emptySet())

		assertEquals(SharedArticlesDrop.Unticked(work), drop)
		assertEquals(work, drop.choice)
		assertFalse(drop.showsTick)
		assertEquals("an unticked row still names its readlist", "Work", drop.label)
	}

	@Test
	fun `without a root no readlist is treated as mainline`() {
		val all = readlist("All", "/queue")

		val drop = SharedArticlesDrop.of(all, mainlineHref = null, tickedHrefs = emptySet())

		assertEquals("a null root never makes a readlist the locked mainline", SharedArticlesDrop.Unticked(all), drop)
	}

	@Test
	fun `firstAsk starts every extra unticked and locks mainline`() {
		val drops = SharedArticlesDrop.firstAsk(
			readlists = listOf(readlist("All", "/queue"), readlist("Work", "/queue?queue=work")),
			mainlineHref = "/queue",
		)

		assertEquals(
			listOf(SharedArticlesDrop.Always("All"), SharedArticlesDrop.Unticked(readlist("Work", "/queue?queue=work"))),
			drops,
		)
	}

	@Test
	fun `the title reflects whether the row is ticked`() {
		assertEquals(
			"Shared articles drop here",
			SharedArticlesDropPresentation.title(SharedArticlesDrop.Always("All")),
		)
		assertEquals(
			"Want shared article to drop here?",
			SharedArticlesDropPresentation.title(SharedArticlesDrop.Unticked(readlist("Work", "/queue?queue=work"))),
		)
	}

	@Test
	fun `only mainline carries the always-drops explanation`() {
		assertEquals(
			"Articles always drop on All. Reading one marks as read in all readlists.",
			SharedArticlesDropPresentation.explanation(SharedArticlesDrop.Always("All")),
		)
		assertNull(
			"a toggleable extra needs no explanation",
			SharedArticlesDropPresentation.explanation(SharedArticlesDrop.Unticked(readlist("Work", "/queue?queue=work"))),
		)
	}
}
