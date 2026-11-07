import { mkdirSync } from "node:fs";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { SearchService } from "./services/search.js";
import { backupDaily } from "./services/backup.js";

mkdirSync("./data", { recursive: true });
const { db, sqlite } = createDb("./data/master-ai.sqlite");
// Дневная резервная копия с ротацией — до того, как сервер начнёт писать в базу.
backupDaily(sqlite, "./data/backups").then((f) => {
  if (f) console.log(`бэкап БД: ${f}`);
}).catch((err) => console.error("не удалось сделать бэкап БД:", err));
new SearchService(db).reindexAll();
const app = buildApp({ db, sqlite });

const port = 5174;
app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`master-ai server on http://127.0.0.1:${port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
