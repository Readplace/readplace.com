import { createHutchApp } from "./app";
import { requireEnv } from "./require-env";

const PORT = requireEnv("PORT", { defaultValue: "3000" });

const { app } = createHutchApp();

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
