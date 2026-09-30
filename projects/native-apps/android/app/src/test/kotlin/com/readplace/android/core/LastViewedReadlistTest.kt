package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LastViewedReadlistTest {
	@Test
	fun `a fresh store remembers nothing`() {
		assertNull(LastViewedReadlist(InMemoryReaderChoiceStorage()).href)
	}

	@Test
	fun `remember then read returns the href`() {
		val store = LastViewedReadlist(InMemoryReaderChoiceStorage())

		store.remember("/queue?queue=work")

		assertEquals("/queue?queue=work", store.href)
	}

	@Test
	fun `a later remember replaces the earlier href`() {
		val store = LastViewedReadlist(InMemoryReaderChoiceStorage())
		store.remember("/queue?queue=work")

		store.remember("/queue")

		assertEquals("/queue", store.href)
	}

	@Test
	fun `forget clears the remembered href`() {
		val store = LastViewedReadlist(InMemoryReaderChoiceStorage())
		store.remember("/queue?queue=work")

		store.forget()

		assertNull(store.href)
	}

	@Test
	fun `a fresh instance over the same storage reads previous writes`() {
		val storage = InMemoryReaderChoiceStorage()
		LastViewedReadlist(storage).remember("/queue?queue=work")

		assertEquals("/queue?queue=work", LastViewedReadlist(storage).href)
	}
}
