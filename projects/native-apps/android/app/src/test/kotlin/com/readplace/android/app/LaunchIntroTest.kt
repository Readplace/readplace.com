package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchIntroTest {
	// region initialPhase(isFirstLaunch, reduceMotion)

	@Test
	fun `first launch without reduce motion starts playing`() {
		assertEquals(
			LaunchIntroPhase.PLAYING,
			LaunchIntro.initialPhase(isFirstLaunch = true, reduceMotion = false),
		)
	}

	@Test
	fun `a returning launch starts idle`() {
		assertEquals(
			LaunchIntroPhase.IDLE,
			LaunchIntro.initialPhase(isFirstLaunch = false, reduceMotion = false),
		)
	}

	@Test
	fun `reduce motion starts idle on a first launch`() {
		assertEquals(
			LaunchIntroPhase.IDLE,
			LaunchIntro.initialPhase(isFirstLaunch = true, reduceMotion = true),
		)
	}

	// endregion

	// region overlay(phase)

	@Test
	fun `the playing overlay shows the video at full opacity on a dark backdrop`() {
		assertEquals(
			LaunchIntroOverlay(showsVideo = true, opacity = 1.0, usesDarkBackdrop = true),
			LaunchIntro.overlay(LaunchIntroPhase.PLAYING),
		)
	}

	@Test
	fun `the fading overlay drops the dark backdrop so the white ending cannot dim`() {
		assertEquals(
			LaunchIntroOverlay(showsVideo = true, opacity = 0.0, usesDarkBackdrop = false),
			LaunchIntro.overlay(LaunchIntroPhase.FADING),
		)
	}

	@Test
	fun `the idle overlay renders nothing`() {
		assertEquals(
			LaunchIntroOverlay(showsVideo = false, opacity = 0.0, usesDarkBackdrop = false),
			LaunchIntro.overlay(LaunchIntroPhase.IDLE),
		)
	}

	@Test
	fun `the finished overlay renders nothing`() {
		assertEquals(
			LaunchIntroOverlay(showsVideo = false, opacity = 0.0, usesDarkBackdrop = false),
			LaunchIntro.overlay(LaunchIntroPhase.FINISHED),
		)
	}

	// endregion

	// region next(after, end)

	@Test
	fun `playing to end moves to fading`() {
		assertEquals(
			LaunchIntroPhase.FADING,
			LaunchIntro.next(after = LaunchIntroPhase.PLAYING, end = LaunchIntroEnd.PLAYED_TO_END),
		)
	}

	@Test
	fun `a failed asset moves to fading`() {
		assertEquals(
			LaunchIntroPhase.FADING,
			LaunchIntro.next(after = LaunchIntroPhase.PLAYING, end = LaunchIntroEnd.ASSET_FAILED),
		)
	}

	@Test
	fun `a timeout moves to fading`() {
		assertEquals(
			LaunchIntroPhase.FADING,
			LaunchIntro.next(after = LaunchIntroPhase.PLAYING, end = LaunchIntroEnd.TIMED_OUT),
		)
	}

	@Test
	fun `a skip moves straight to finished`() {
		assertEquals(
			LaunchIntroPhase.FINISHED,
			LaunchIntro.next(after = LaunchIntroPhase.PLAYING, end = LaunchIntroEnd.SKIPPED),
		)
	}

	@Test
	fun `a transition from a non-playing phase is ignored`() {
		assertEquals(
			LaunchIntroPhase.FADING,
			LaunchIntro.next(after = LaunchIntroPhase.FADING, end = LaunchIntroEnd.TIMED_OUT),
		)
		assertEquals(
			LaunchIntroPhase.IDLE,
			LaunchIntro.next(after = LaunchIntroPhase.IDLE, end = LaunchIntroEnd.SKIPPED),
		)
	}

	// endregion

	// region playsMusic(isLoggedIn, isForeground)

	@Test
	fun `music plays while logged out and foreground`() {
		assertTrue(LaunchIntro.playsMusic(isLoggedIn = false, isForeground = true))
	}

	@Test
	fun `music stops once logged in`() {
		assertFalse(LaunchIntro.playsMusic(isLoggedIn = true, isForeground = true))
	}

	@Test
	fun `music stops in the background`() {
		assertFalse(LaunchIntro.playsMusic(isLoggedIn = false, isForeground = false))
	}

	// endregion

	// region durations

	@Test
	fun `the timings match the intro video`() {
		assertEquals(0.45, LaunchIntro.FADE_DURATION, 0.0)
		assertEquals(3.0, LaunchIntro.WATCHDOG_SLACK, 0.0)
		assertEquals(8.083333, LaunchIntro.VIDEO_DURATION, 0.0)
		assertEquals(0.378, LaunchIntro.LOGO_SCREEN_FRACTION, 0.0)
	}

	// endregion
}
