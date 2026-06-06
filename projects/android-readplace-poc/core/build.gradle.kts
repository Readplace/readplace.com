plugins {
	kotlin("jvm") version "2.0.21"
	kotlin("plugin.serialization") version "2.0.21"
}

// Consumed by the Android app via dependency substitution (includeBuild), so the
// coordinates must match the dependency the app declares.
group = "com.readplace.poc"
version = "0.1.0"

dependencies {
	implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

	testImplementation(platform("org.junit:junit-bom:5.11.3"))
	testImplementation("org.junit.jupiter:junit-jupiter")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
	useJUnitPlatform()
	testLogging { events("passed", "skipped", "failed") }
}
