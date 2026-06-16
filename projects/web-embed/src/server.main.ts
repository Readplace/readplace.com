import express from "express";
import { initEmbedRoutes } from "./embed/embed.page";

const PORT = Number(process.env.E2E_PORT ?? process.env.PORT ?? 3700);
const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${PORT}`;

const app = express();
app.use("/embed", initEmbedRoutes({ appOrigin }));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

app.listen(PORT);
