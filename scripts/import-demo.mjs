import { readFile } from "node:fs/promises";

const data = await readFile(new URL("../examples/demo-campaign.json", import.meta.url), "utf8");

try {
  const response = await fetch("http://127.0.0.1:5174/api/campaigns/import-json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: data,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`API вернул HTTP ${response.status}`);
  const campaign = await response.json();
  console.log(`Импортирована новая кампания «${campaign.name}».`);
  console.log(`http://localhost:5173/campaigns/${encodeURIComponent(campaign.id)}`);
} catch (error) {
  console.error(`Не удалось импортировать пример: ${error.message}.`);
  console.error("Запустите pnpm dev в другом терминале и повторите pnpm demo:import.");
  process.exitCode = 1;
}
