package com.readplace.android.app

enum class LaunchIntroEnd {
	PLAYED_TO_END,
	ASSET_FAILED,
	TIMED_OUT,
	SKIPPED,
}

enum class LaunchIntroPhase {
	IDLE,
	PLAYING,
	FADING,
	FINISHED,
}

data class LaunchIntroOverlay(
	val showsVideo: Boolean,
	val opacity: Double,
	val usesDarkBackdrop: Boolean,
)

object LaunchIntro {
	fun initialPhase(isFirstLaunch: Boolean, reduceMotion: Boolean): LaunchIntroPhase =
		if (isFirstLaunch && !reduceMotion) LaunchIntroPhase.PLAYING else LaunchIntroPhase.IDLE

	fun overlay(phase: LaunchIntroPhase): LaunchIntroOverlay =
		when (phase) {
			LaunchIntroPhase.IDLE, LaunchIntroPhase.FINISHED ->
				LaunchIntroOverlay(showsVideo = false, opacity = 0.0, usesDarkBackdrop = false)
			LaunchIntroPhase.PLAYING ->
				LaunchIntroOverlay(showsVideo = true, opacity = 1.0, usesDarkBackdrop = true)
			LaunchIntroPhase.FADING ->
				LaunchIntroOverlay(showsVideo = true, opacity = 0.0, usesDarkBackdrop = false)
		}

	fun next(after: LaunchIntroPhase, end: LaunchIntroEnd): LaunchIntroPhase {
		if (after != LaunchIntroPhase.PLAYING) return after
		return if (end == LaunchIntroEnd.SKIPPED) LaunchIntroPhase.FINISHED else LaunchIntroPhase.FADING
	}

	fun playsMusic(isLoggedIn: Boolean, isForeground: Boolean): Boolean = !isLoggedIn && isForeground

	const val FADE_DURATION = 0.45

	const val WATCHDOG_SLACK = 3.0

	const val VIDEO_DURATION = 8.083333

	const val LOGO_SCREEN_FRACTION = 0.378
}
