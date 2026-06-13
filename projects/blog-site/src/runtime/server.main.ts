import { createBlogApp, PORT } from "./app";
import { getEnv, requireEnv } from "./require-env";

const app = createBlogApp({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
});

app.listen(PORT, () => {
	console.log(`blog-site is running on http://localhost:${PORT}`);
});
