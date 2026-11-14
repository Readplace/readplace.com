package com.readplace.android.testing

import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import org.junit.rules.ExternalResource
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

class ComposeHostActivityRule : ExternalResource() {
	override fun before() {
		val app = RuntimeEnvironment.getApplication()
		shadowOf(app.packageManager).addOrUpdateActivity(
			ActivityInfo().apply {
				name = ComponentActivity::class.java.name
				packageName = app.packageName
			},
		)
	}
}
