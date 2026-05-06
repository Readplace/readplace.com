import { createHutchApp } from "./app";
import { PORT } from "./server";

const { app } = createHutchApp();

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
