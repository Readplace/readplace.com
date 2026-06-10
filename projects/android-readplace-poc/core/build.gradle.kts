plugins {
	kotlin("jvm") version "2.0.21"
	kotlin("plugin.serialization") version "2.0.21"
}

// Consumed by the Android app via dependency substitution (includeBuild), so the
// coordinates must match the dependency the app declares.
group = "com.readplace.poc"
version = "0.1.0"

// Match the Android app's jvmTarget so its dexer never sees newer bytecode, while
// still building on any JDK >= 17 (a toolchain pin would instead require that
// exact JDK to be installed). Java compatibility must agree or the Kotlin
// plugin's JVM-target validation fails the build.
kotlin {
	compilerOptions {
		jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
	}
}

java {
	sourceCompatibility = JavaVersion.VERSION_17
	targetCompatibility = JavaVersion.VERSION_17
}

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
