import "./lib/env.js"; // must be first — loads .env before anything reads it
import { createApp } from "./app.js";
import { log } from "./lib/logger.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  log.info("server.listening", { port });
});
