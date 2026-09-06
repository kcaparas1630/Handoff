import path from "node:path";

import { createRequestHandler } from "expo-server/adapter/express";
import express from "express";

// Hosting adapter only. Routes live in src/app as Expo Router +api handlers.
// Resolve the build relative to this file so the server starts from any working directory.
const clientBuildDir = path.join(import.meta.dirname, "dist/client");
const serverBuildDir = path.join(import.meta.dirname, "dist/server");

const app = express();
app.disable("x-powered-by");
app.use(express.static(clientBuildDir, { maxAge: "1h", extensions: ["html"] }));
app.all("/{*all}", createRequestHandler({ build: serverBuildDir }));

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  // Port only: request URLs and headers can carry identifiers and tokens.
  console.log(`Handoff API listening on port ${port}`);
});
