package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchIntroModelTest {
	private class MusicLog : IntroMusic {
		var starts = 0
		var stops = 0
		var restarts = 0
		val seeks = mutableListOf<Double>()
		var muted: Boolean? = null

		override fun start() {
			starts += 1
		}

		override fun stop() {
			stops += 1
		}

		override fun restart() {
			restarts += 1
		}

		override fun seek(seconds: Double) {
			seeks.add(seconds)
		}

		override fun setMuted(muted: Boolean) {
			this.muted = muted
		}
	}

	private class EphemeralFlags : KeyValueFlags {
		private val values = mutableMapOf<String, Boolean>()

		override fun getBoolean(key: String): Boolean? = values[key]

		override fun putBoolean(key: String, value: Boolean) {
			values[key] = value
		}
	}

	private fun freshSeen(): LaunchIntroSeen = LaunchIntroSeen(EphemeralFlags())

	private fun consumedSeen(): LaunchIntroSeen {
		val flags = EphemeralFlags()
		LaunchIntroSeen(flags).claim()
		return LaunchIntroSeen(flags)
	}

	private fun mutePreference(muted: Boolean = false): IntroMutePreference =
		IntroMutePreference(EphemeralFlags()).apply { isMuted = muted }

	private fun makeModel(
		log: MusicLog,
		seen: LaunchIntroSeen,
		reduceMotion: Boolean = false,
		mute: IntroMutePreference = mutePreference(),
		isLoggedIn: Boolean = false,
	): LaunchIntroModel =
		LaunchIntroModel(
			seen = seen,
			music = log,
			mutePreference = mute,
			reduceMotion = reduceMotion,
			isLoggedIn = isLoggedIn,
		)

	// region launch

	@Test
	fun `a first launch starts the music immediately`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())

		assertEquals(LaunchIntroPhase.PLAYING, model.phase.value)
		assertEquals(1, log.starts)
	}

	@Test
	fun `a returning logged-out launch starts the login music without the video`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = consumedSeen())

		assertEquals("the video is once per install", LaunchIntroPhase.IDLE, model.phase.value)
		assertEquals(
			"the theme is standing login-screen music, not the video's soundtrack",
			1,
			log.starts,
		)
	}

	@Test
	fun `a reduce motion launch plays the music but not the video`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen(), reduceMotion = true)

		assertEquals("reduce motion suppresses the video", LaunchIntroPhase.IDLE, model.phase.value)
		assertEquals("reduce motion is a motion setting, not an audio one", 1, log.starts)
	}

	@Test
	fun `a returning launch by a logged-in user starts nothing`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = consumedSeen(), isLoggedIn = true)

		assertEquals(LaunchIntroPhase.IDLE, model.phase.value)
		assertEquals("there is no login screen to score", 0, log.starts)
	}

	@Test
	fun `a first launch while logged in plays the video silently`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen(), isLoggedIn = true)

		assertEquals(LaunchIntroPhase.PLAYING, model.phase.value)
		assertEquals(0, log.starts)
	}

	@Test
	fun `the initial mute state reflects the saved preference`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen(), mute = mutePreference(muted = true))

		assertTrue(model.isMuted.value)
		assertEquals("the saved mute preference is applied to the player at launch", true, log.muted)
	}

	// endregion

	// region end(reason) / fadeCompleted()

	@Test
	fun `ending playback moves to fading and keeps the music running`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())

		model.end(LaunchIntroEnd.PLAYED_TO_END)

		assertEquals(LaunchIntroPhase.FADING, model.phase.value)
		assertEquals("the music outlives the video and stops on login, not on dismissal", 0, log.stops)
	}

	@Test
	fun `skipping jumps the music to the video end and keeps it playing`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())

		model.end(LaunchIntroEnd.SKIPPED)

		assertEquals(LaunchIntroPhase.FINISHED, model.phase.value)
		assertEquals(
			"skipping does not stop the music; it stays in sync with the video's end",
			0,
			log.stops,
		)
		assertEquals(
			"the music jumps to where it would be at the video's natural end",
			listOf(LaunchIntro.VIDEO_DURATION),
			log.seeks,
		)
	}

	@Test
	fun `fade completed finishes`() {
		val model = makeModel(log = MusicLog(), seen = freshSeen())
		model.end(LaunchIntroEnd.PLAYED_TO_END)

		model.fadeCompleted()

		assertEquals(LaunchIntroPhase.FINISHED, model.phase.value)
	}

	@Test
	fun `fade completed from a non-fading phase is ignored`() {
		val model = makeModel(log = MusicLog(), seen = freshSeen())

		model.fadeCompleted()

		assertEquals(LaunchIntroPhase.PLAYING, model.phase.value)
	}

	// endregion

	// region replay()

	@Test
	fun `replay restarts the video and the music from the login screen`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())
		model.end(LaunchIntroEnd.SKIPPED)

		model.replay()

		assertEquals("replay re-enters the intro", LaunchIntroPhase.PLAYING, model.phase.value)
		assertEquals("the music restarts with the intro", 1, log.restarts)
	}

	@Test
	fun `replay works on a returning launch that never played the intro`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = consumedSeen())
		assertEquals(LaunchIntroPhase.IDLE, model.phase.value)

		model.replay()

		assertEquals(LaunchIntroPhase.PLAYING, model.phase.value)
		assertEquals(1, log.restarts)
	}

	@Test
	fun `replay unmutes the music and remembers it`() {
		val log = MusicLog()
		val preference = mutePreference(muted = true)
		val model = makeModel(log = log, seen = freshSeen(), mute = preference)
		assertTrue("started muted from the saved preference", model.isMuted.value)

		model.replay()

		assertFalse("opening the video unmutes", model.isMuted.value)
		assertFalse("and the unmute is remembered", preference.isMuted)
		assertEquals(false, log.muted)
	}

	// endregion

	// region toggleMute()

	@Test
	fun `toggling mute persists, applies, and flips back`() {
		val log = MusicLog()
		val preference = mutePreference(muted = false)
		val model = makeModel(log = log, seen = freshSeen(), mute = preference)

		model.toggleMute()

		assertTrue(model.isMuted.value)
		assertEquals(true, log.muted)
		assertTrue("the preference is remembered across launches", preference.isMuted)

		model.toggleMute()

		assertFalse(model.isMuted.value)
		assertEquals(false, log.muted)
		assertFalse(preference.isMuted)
	}

	// endregion

	// region sync(isLoggedIn, isForeground)

	@Test
	fun `sync stops the music on login`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())

		model.sync(isLoggedIn = true, isForeground = true)

		assertEquals(1, log.stops)
	}

	@Test
	fun `sync stops the music on backgrounding`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())

		model.sync(isLoggedIn = false, isForeground = false)

		assertEquals(1, log.stops)
	}

	@Test
	fun `sync restarts the music on returning to the foreground while logged out`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())

		model.sync(isLoggedIn = false, isForeground = true)

		assertEquals(
			"returning to the foreground while logged out resumes the intro music",
			2,
			log.starts,
		)
	}

	@Test
	fun `sync starts the login music after logout`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = consumedSeen(), isLoggedIn = true)
		assertEquals("a logged-in launch is silent", 0, log.starts)

		model.sync(isLoggedIn = false, isForeground = true)

		assertEquals("logging out lands on the login screen, which has its music", 1, log.starts)
	}

	@Test
	fun `the music keeps looping on the login screen across a background hop after the video finishes`() {
		val log = MusicLog()
		val model = makeModel(log = log, seen = freshSeen())
		model.end(LaunchIntroEnd.PLAYED_TO_END)
		model.fadeCompleted()

		model.sync(isLoggedIn = false, isForeground = false)
		model.sync(isLoggedIn = false, isForeground = true)

		assertEquals(LaunchIntroPhase.FINISHED, model.phase.value)
		assertEquals("backgrounding pauses the theme", 1, log.stops)
		assertEquals("the theme resumes while the user is still on the login screen", 2, log.starts)
	}

	// endregion

	// region overlay

	@Test
	fun `the overlay reflects the current phase`() {
		val model = makeModel(log = MusicLog(), seen = freshSeen())

		assertEquals(LaunchIntro.overlay(model.phase.value), model.overlay)
	}

	// endregion
}
