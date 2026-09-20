package com.readplace.android.app

import androidx.lifecycle.ViewModel

class LaunchIntroOwner(
	val model: LaunchIntroModel,
	private val music: IntroMusic,
) : ViewModel() {
	override fun onCleared() {
		music.release()
	}
}
