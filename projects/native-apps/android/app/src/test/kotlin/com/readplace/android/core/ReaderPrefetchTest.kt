package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderPrefetchTest {
	@Test
	fun `a page is stored only when it finished with no main-frame failure and no main-frame HTTP error`() {
		val outcomes = buildList {
			for (documentFinished in listOf(true, false)) {
				for (mainFrameFailed in listOf(true, false)) {
					for (mainFrameHttpError in listOf(null, 404)) {
						val stored = ReaderPrefetch.wasStored(
							documentFinished = documentFinished,
							mainFrameFailed = mainFrameFailed,
							mainFrameHttpError = mainFrameHttpError,
						)
						if (stored) add(Triple(documentFinished, mainFrameFailed, mainFrameHttpError))
					}
				}
			}
		}

		assertEquals(listOf(Triple(true, false, null)), outcomes)
	}

	@Test
	fun `images are settled only when the page answers true`() {
		val answers = listOf("true", "false", "null", null).map { ReaderPrefetch.imagesSettled(it) }

		assertEquals(listOf(true, false, false, false), answers)
	}
}
