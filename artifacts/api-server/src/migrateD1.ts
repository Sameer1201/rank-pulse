import "./lib/loadEnv";
import { initializeD1Schema } from "@workspace/db";

async function main() {
  await initializeD1Schema();
  console.log("Cloudflare D1 schema migration complete");
}

main().catch((error) => {
  console.error("Cloudflare D1 schema migration failed", error);
  process.exitCode = 1;
});
