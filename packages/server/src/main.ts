import { mkdirSync } from "node:fs";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { SearchService } from "./services/search.js";

mkdirSync("./data", { recursive: true });
const { db } = createDb("./data/master-ai.sqlite");
new SearchService(db).reindexAll();
const app = buildApp({ db });

const port = 5174;
app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`master-ai server on http://127.0.0.1:${port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
