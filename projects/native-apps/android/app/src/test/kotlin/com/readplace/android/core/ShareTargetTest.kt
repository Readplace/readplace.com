package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareTargetTest {
	@Test
	fun `a fresh store is undecided with no hrefs`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())

		assertFalse(store.isDecided)
		assertEquals(emptySet<String>(), store.hrefs)
	}

	@Test
	fun `recording a nonempty set decides it and keeps the hrefs`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())

		store.record(setOf("/queue?queue=work", "/queue?queue=later"))

		assertTrue(store.isDecided)
		assertEquals(setOf("/queue?queue=work", "/queue?queue=later"), store.hrefs)
	}

	@Test
	fun `recording an empty set is a decided answer, not unasked`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())

		store.record(emptySet())

		assertTrue("a written empty set means the reader chose mainline only", store.isDecided)
		assertEquals(emptySet<String>(), store.hrefs)
	}

	@Test
	fun `add on an unasked store decides it with the one href`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())

		store.add("/queue?queue=work")

		assertTrue(store.isDecided)
		assertEquals(setOf("/queue?queue=work"), store.hrefs)
	}

	@Test
	fun `remove of the last extra leaves a decided empty answer`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())
		store.record(setOf("/queue?queue=work"))

		store.remove("/queue?queue=work")

		assertTrue("removing the last extra is still a chosen answer", store.isDecided)
		assertEquals(emptySet<String>(), store.hrefs)
	}

	@Test
	fun `add and remove build up and pare down the set`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())

		store.add("/queue?queue=work")
		store.add("/queue?queue=later")
		store.remove("/queue?queue=work")

		assertEquals(setOf("/queue?queue=later"), store.hrefs)
	}

	@Test
	fun `forget returns the store to unasked`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())
		store.record(setOf("/queue?queue=work"))

		store.forget()

		assertFalse(store.isDecided)
		assertEquals(emptySet<String>(), store.hrefs)
	}

	@Test
	fun `a fresh instance over the same storage reads previous writes`() {
		val storage = InMemoryReaderChoiceStorage()
		ShareTarget(storage).record(setOf("/queue?queue=work"))

		val reopened = ShareTarget(storage)

		assertTrue(reopened.isDecided)
		assertEquals(setOf("/queue?queue=work"), reopened.hrefs)
	}

	@Test
	fun `the recorded set is copied, so mutating the caller's set does not leak`() {
		val store = ShareTarget(InMemoryReaderChoiceStorage())
		val hrefs = mutableSetOf("/queue?queue=work")

		store.record(hrefs)
		hrefs.add("/queue?queue=later")

		assertEquals(setOf("/queue?queue=work"), store.hrefs)
	}
}
