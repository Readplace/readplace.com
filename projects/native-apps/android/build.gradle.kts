// AGP 9 carries Kotlin support itself, so there is no `kotlin-android` plugin here:
// applying one is now an error rather than a duplicate.
plugins {
	alias(libs.plugins.android.application) apply false
	alias(libs.plugins.kotlin.compose) apply false
	alias(libs.plugins.kotlin.serialization) apply false
}
