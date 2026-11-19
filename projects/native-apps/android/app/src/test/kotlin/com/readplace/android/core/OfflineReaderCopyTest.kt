package com.readplace.android.core

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Duration
import java.time.Instant

class OfflineReaderCopyTest {
	@get:Rule
	val temporaryFolder = TemporaryFolder()

	private val articleA = "https://readplace.com/read/a?platform=android"
	private val articleB = "https://readplace.com/read/b?platform=android"

	private var clock = Instant.parse("2026-11-12T00:00:00Z")

	private fun TestScope.store(directory: File): OfflineReaderCopy =
		OfflineReaderCopy(directory, StandardTestDispatcher(testScheduler), now = { clock })

	@Test
	fun `a recorded copy is shown for 30 days and not a second longer`() = runTest {
		val copies = store(temporaryFolder.newFolder())

		copies.record(articleA)
		val justRecorded = copies.isShowable(articleA)
		clock = clock.plus(Duration.ofDays(30))
		val thirtyDaysOn = copies.isShowable(articleA)
		clock = clock.plusSeconds(1)
		val oneSecondLater = copies.isShowable(articleA)

		assertEquals(listOf(true, true, false), listOf(justRecorded, thirtyDaysOn, oneSecondLater))
	}

	@Test
	fun `a copy never recorded is not shown`() = runTest {
		val copies = store(temporaryFolder.newFolder())

		copies.record(articleB)

		assertEquals(
			"a copy whose age cannot be told could otherwise be shown forever",
			listOf(false, true),
			listOf(copies.isShowable(articleA), copies.isShowable(articleB)),
		)
	}

	@Test
	fun `recording again restarts the 30 days`() = runTest {
		val copies = store(temporaryFolder.newFolder())

		copies.record(articleA)
		clock = clock.plus(Duration.ofDays(29))
		copies.record(articleA)
		clock = clock.plus(Duration.ofDays(16))

		assertEquals(true, copies.isShowable(articleA))
	}

	@Test
	fun `a record that is not a number is not shown`() = runTest {
		val directory = temporaryFolder.newFolder()
		val copies = store(directory)

		copies.record(articleA)
		val records = File(directory, "reader-copies").listFiles().orEmpty().toList()
		assertEquals(1, records.size)
		records.single().writeText("yesterday")
		copies.record(articleB)

		assertEquals(listOf(false, true), listOf(copies.isShowable(articleA), copies.isShowable(articleB)))
	}

	@Test
	fun `a second store over the same directory sees the record`() = runTest {
		val directory = temporaryFolder.newFolder()

		store(directory).record(articleA)

		assertEquals(true, store(directory).isShowable(articleA))
	}

	@Test
	fun `a root that cannot be written never fails a load`() = runTest {
		val copies = store(temporaryFolder.newFile("a-file-where-the-root-should-be"))

		copies.record(articleA)

		assertEquals(false, copies.isShowable(articleA))
	}
}
