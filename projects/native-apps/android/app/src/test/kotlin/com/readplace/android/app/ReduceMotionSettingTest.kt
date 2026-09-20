package com.readplace.android.app

import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReduceMotionSettingTest {
	private class ControlledSetting(private var reduceMotion: Boolean) : ReduceMotionSetting {
		private var listener: (() -> Unit)? = null

		val observing: Boolean get() = listener != null

		override fun current(): Boolean = reduceMotion

		override fun observe(onChange: () -> Unit): AutoCloseable {
			listener = onChange
			return AutoCloseable { listener = null }
		}

		fun deliver(reduceMotion: Boolean) {
			this.reduceMotion = reduceMotion
			listener?.invoke()
		}
	}

	@Test
	fun `it emits the current value as soon as it is observed`() = runTest {
		val setting = ControlledSetting(reduceMotion = true)
		val seen = mutableListOf<Boolean>()

		val job = launch { setting.updates().collect { seen.add(it) } }
		runCurrent()

		assertEquals(listOf(true), seen)
		assertTrue("observing registers a change listener", setting.observing)
		job.cancelAndJoin()
	}

	@Test
	fun `it re-reads and emits the value on every change`() = runTest {
		val setting = ControlledSetting(reduceMotion = false)
		val seen = mutableListOf<Boolean>()
		val job = launch { setting.updates().collect { seen.add(it) } }
		runCurrent()

		setting.deliver(reduceMotion = true)
		runCurrent()
		setting.deliver(reduceMotion = false)
		runCurrent()

		assertEquals(listOf(false, true, false), seen)
		job.cancelAndJoin()
	}

	@Test
	fun `a change that leaves the value unchanged is not re-emitted`() = runTest {
		val setting = ControlledSetting(reduceMotion = false)
		val seen = mutableListOf<Boolean>()
		val job = launch { setting.updates().collect { seen.add(it) } }
		runCurrent()

		setting.deliver(reduceMotion = false)
		runCurrent()

		assertEquals(
			"the animator setting notifies on any scale write, not only when reduce-motion flips",
			listOf(false),
			seen,
		)
		job.cancelAndJoin()
	}

	@Test
	fun `it unregisters the change listener when collection stops`() = runTest {
		val setting = ControlledSetting(reduceMotion = false)
		val job = launch { setting.updates().collect { } }
		runCurrent()
		assertTrue("collecting registers the listener", setting.observing)

		job.cancelAndJoin()

		assertFalse("a stopped collector must leave no observer behind", setting.observing)
	}
}
