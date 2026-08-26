package com.readplace.android.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface IntroMusic {
	fun start()

	fun stop()

	fun restart()

	fun seek(seconds: Double)

	fun setMuted(muted: Boolean)
}

class LaunchIntroModel(
	seen: LaunchIntroSeen,
	private val music: IntroMusic,
	private val mutePreference: IntroMutePreference,
	reduceMotion: Boolean,
	isLoggedIn: Boolean,
) {
	private val _isMuted = MutableStateFlow(mutePreference.isMuted)
	val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

	private val _phase = MutableStateFlow(
		LaunchIntro.initialPhase(isFirstLaunch = seen.claim(), reduceMotion = reduceMotion),
	)
	val phase: StateFlow<LaunchIntroPhase> = _phase.asStateFlow()

	init {
		music.setMuted(_isMuted.value)
		if (LaunchIntro.playsMusic(isLoggedIn = isLoggedIn, isForeground = true)) {
			music.start()
		}
	}

	val overlay: LaunchIntroOverlay
		get() = LaunchIntro.overlay(_phase.value)

	fun end(reason: LaunchIntroEnd) {
		_phase.value = LaunchIntro.next(after = _phase.value, end = reason)
		if (reason == LaunchIntroEnd.SKIPPED) {
			music.seek(LaunchIntro.VIDEO_DURATION)
		}
	}

	fun fadeCompleted() {
		if (_phase.value != LaunchIntroPhase.FADING) return
		_phase.value = LaunchIntroPhase.FINISHED
	}

	fun replay() {
		_phase.value = LaunchIntroPhase.PLAYING
		_isMuted.value = false
		mutePreference.isMuted = false
		music.setMuted(false)
		music.restart()
	}

	fun toggleMute() {
		val muted = !_isMuted.value
		_isMuted.value = muted
		mutePreference.isMuted = muted
		music.setMuted(muted)
	}

	fun sync(isLoggedIn: Boolean, isForeground: Boolean) {
		if (LaunchIntro.playsMusic(isLoggedIn = isLoggedIn, isForeground = isForeground)) {
			music.start()
		} else {
			music.stop()
		}
	}
}
