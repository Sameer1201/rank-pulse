import "./lib/loadEnv";
import http from "http";
import app from "./app";
import { initializeD1Schema } from "@workspace/db";

const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

async function startServer() {
  await initializeD1Schema();
  server.listen(port, () => {
    void bootstrap();
  });
}

void startServer().catch((error) => {
  console.error("Failed to initialize Cloudflare D1", error);
  process.exitCode = 1;
});

async function bootstrap() {
  const [
    { createLiveServer, handleUpgrade },
    { logger },
    { seedDefaultUsers },
    { startDigestScheduler },
    { startPendingReviewScheduler },
    { startExportScheduler },
      { repairStoredNumericAnswers },
  ] = await Promise.all([
    import("./live"),
    import("./lib/logger"),
    import("./seed"),
    import("./lib/digestScheduler"),
    import("./lib/pendingReviewScheduler"),
    import("./lib/exportScheduler"),
    import("./lib/numericAnswerRepair"),
  ]);

  const wss = createLiveServer();
  server.on("upgrade", (req, socket, head) => {
    handleUpgrade(wss, req, socket, head);
  });

  logger.info({ port }, "Server listening");
  startDigestScheduler();
  startPendingReviewScheduler();
  startExportScheduler();

  repairStoredNumericAnswers()
    .then((summary) => {
      if (summary.testQuestionCount > 0 || summary.questionBankCount > 0) {
        logger.info(summary, "Repaired imported decimal/range answers");
      }
    })
    .catch((err) => logger.warn({ err }, "Numeric answer repair skipped (non-fatal)"));

  seedDefaultUsers()
    .then(() => logger.info("Default users seeded successfully"))
    .catch((err) => logger.warn({ err }, "Failed to seed default users (non-fatal)"));
}
