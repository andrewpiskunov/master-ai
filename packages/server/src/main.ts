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

// Closing Fastify also stops background image jobs and removes their workspaces.
// This matters during tsx watch restarts as well as a normal local shutdown.
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  void app.close().then(() => {
    sqlite.close();
    process.exit(0);
  }).catch((error) => {
    console.error("не удалось завершить работу сервера:", error);
    process.exit(1);
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

const port = 5174;
app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`master-ai server on http://127.0.0.1:${port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
