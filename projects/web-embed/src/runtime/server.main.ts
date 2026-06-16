import express from "express";
import { initEmbedRoutes } from "./embed/embed.page";
import { requireEnv } from "./require-env";

const PORT = Number(requireEnv("E2E_PORT"));
const appOrigin = `http://localhost:${PORT}`;

const app = express();
app.disable("x-powered-by");
app.use("/embed", initEmbedRoutes({ appOrigin }));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

app.listen(PORT);
