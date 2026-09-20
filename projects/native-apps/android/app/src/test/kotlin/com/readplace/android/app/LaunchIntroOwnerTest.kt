package com.readplace.android.app

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class LaunchIntroOwnerTest {
	private class MusicLog : IntroMusic {
		var starts = 0
		var restarts = 0
		val seeks = mutableListOf<Double>()
		var releases = 0

		override fun start() {
			starts += 1
		}

		override fun stop() = Unit

		override fun restart() {
			restarts += 1
		}

		override fun seek(seconds: Double) {
			seeks.add(seconds)
		}

		override fun setMuted(muted: Boolean) = Unit

		override fun release() {
			releases += 1
		}
	}

	private class EphemeralFlags : KeyValueFlags {
		private val values = mutableMapOf<String, Boolean>()

		override fun getBoolean(key: String): Boolean? = values[key]

		override fun putBoolean(key: String, value: Boolean) {
			values[key] = value
		}
	}

	private fun ownerFactory(
		music: IntroMusic,
		flags: KeyValueFlags,
		onBuild: () -> Unit = {},
	): ViewModelProvider.Factory =
		viewModelFactory {
			initializer {
				onBuild()
				LaunchIntroOwner(
					model = LaunchIntroModel(
						seen = LaunchIntroSeen(flags),
						music = music,
						mutePreference = IntroMutePreference(flags),
						reduceMotion = false,
						isLoggedIn = false,
					),
					music = music,
				)
			}
		}

	@Test
	fun `the owner and its model are constructed once and reused across activity recreation`() {
		val store = ViewModelStore()
		val music = MusicLog()
		val flags = EphemeralFlags()
		var builds = 0

		fun attach(): LaunchIntroOwner =
			ViewModelProvider(store, ownerFactory(music, flags) { builds += 1 }).get(LaunchIntroOwner::class)

		val first = attach()
		val afterRecreation = attach()

		assertSame("recreation reuses the retained owner", first, afterRecreation)
		assertSame("and the same intro model", first.model, afterRecreation.model)
		assertEquals("the model and player are built once for the root lifetime", 1, builds)
		assertEquals("the retained phase survives recreation without re-claiming first launch", LaunchIntroPhase.PLAYING, afterRecreation.model.phase.value)
		assertEquals("the login music started once, not once per recreation", 1, music.starts)
	}

	@Test
	fun `a configuration detach keeps the player and a permanent clear releases it once`() {
		val store = ViewModelStore()
		val music = MusicLog()
		val flags = EphemeralFlags()

		fun attach(): LaunchIntroOwner =
			ViewModelProvider(store, ownerFactory(music, flags)).get(LaunchIntroOwner::class)

		attach()
		attach()
		assertEquals("a configuration change must not release the retained player", 0, music.releases)

		store.clear()

		assertEquals("permanently clearing the owner releases the player exactly once", 1, music.releases)
	}

	@Test
	fun `explicit replay and skip after recreation reach the retained model and its music`() {
		val store = ViewModelStore()
		val music = MusicLog()
		val flags = EphemeralFlags()

		fun attach(): LaunchIntroOwner =
			ViewModelProvider(store, ownerFactory(music, flags)).get(LaunchIntroOwner::class)

		attach()
		val model = attach().model

		model.replay()
		assertEquals("replay after recreation restarts the retained player once", 1, music.restarts)
		assertEquals(LaunchIntroPhase.PLAYING, model.phase.value)

		model.end(LaunchIntroEnd.SKIPPED)
		assertEquals("skip after recreation seeks the retained player to the video end", listOf(LaunchIntro.VIDEO_DURATION), music.seeks)
	}
}
