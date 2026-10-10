import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function requireSuperAdmin(req: any, res: any): boolean {
  const callerRole = req.cookies?.userRole;
  if (!callerRole) { res.status(401).json({ error: "Not authenticated" }); return false; }
  if (callerRole !== "super_admin") { res.status(403).json({ error: "Forbidden – super_admin only" }); return false; }
  return true;
}

const router: IRouter = Router();

const ALLOWED_TABLES = [
  "users", "subjects", "chapters", "tests", "test_sections", "test_questions",
  "submissions", "q_reports", "question_bank", "question_bank_question_progress",
  "sessions", "notifications", "direct_messages", "activity_logs", "email_send_logs",
  "email_usage", "password_reset_requests", "payment_history", "classes", "enrollments",
  "notification_preferences", "platform_settings", "exam_templates",
  "email_provider_configs", "email_provider_usage",
];

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, "\\$&").replace(/'/g, "''");
}

function buildDbViewerTableListQuery() {
  return sql`
    SELECT name AS table_name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `;
}

router.get("/db-viewer/tables", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const result = await db.execute(buildDbViewerTableListQuery());
    const tables = (result.rows as any[]).map((r) => r.table_name as string);

    const counts = await Promise.all(
      tables.map(async (table) => {
        try {
          const countResult = await db.execute(sql.raw(`SELECT COUNT(*) AS count FROM "${table}"`));
          return { table, count: (countResult.rows[0] as any)?.count ?? 0 };
        } catch {
          return { table, count: 0 };
        }
      })
    );

    res.json({ tables: counts });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to list tables" });
  }
});

router.get("/db-viewer/tables/:tableName/columns", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const { tableName } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return void res.status(400).json({ error: "Invalid table name" });
  try {
    const result = await db.execute(sql.raw(`PRAGMA table_info("${tableName}")`));
    res.json({
      columns: (result.rows as any[]).map((column) => ({
        column_name: column.name,
        data_type: column.type || "text",
        is_nullable: column.notnull ? "NO" : "YES",
        column_default: column.dflt_value ?? null,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to get columns" });
  }
});

router.get("/db-viewer/tables/:tableName/rows", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const { tableName } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return void res.status(400).json({ error: "Invalid table name" });
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const search = (req.query.search as string) || "";
  try {
    const colResult = await db.execute(sql.raw(`PRAGMA table_info("${tableName}")`));
    const columns = (colResult.rows as any[]).map((c) => ({ name: c.name as string, type: c.type as string }));

    let whereClause = "";
    if (search) {
      const textCols = columns.filter((c) => !["integer", "real", "numeric", "boolean"].includes((c.type || "").toLowerCase()));
      if (textCols.length > 0) {
        const escaped = escapeLike(search);
        const conditions = textCols
          .map((c) => `CAST("${c.name}" AS TEXT) LIKE '%${escaped}%' ESCAPE '\\'`)
          .join(" OR ");
        whereClause = `WHERE ${conditions}`;
      }
    }

    const countResult = await db.execute(sql.raw(`SELECT COUNT(*) AS count FROM "${tableName}" ${whereClause}`));
    const total = (countResult.rows[0] as any)?.count ?? 0;

    const rows = await db.execute(sql.raw(`SELECT * FROM "${tableName}" ${whereClause} ORDER BY 1 LIMIT ${limit} OFFSET ${offset}`));

    res.json({ rows: rows.rows, total, columns, limit, offset });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to get rows" });
  }
});

router.put("/db-viewer/tables/:tableName/rows/:id", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const { tableName, id } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return void res.status(400).json({ error: "Invalid table name" });
  const updates = req.body as Record<string, any>;
  if (!updates || typeof updates !== "object") return void res.status(400).json({ error: "Invalid body" });

  const forbidden = ["id", "created_at"];
  const fields = Object.keys(updates).filter((k) => !forbidden.includes(k) && /^[a-zA-Z0-9_]+$/.test(k));
  if (fields.length === 0) return void res.status(400).json({ error: "No valid fields to update" });

  try {
    const pkResult = await db.execute(sql.raw(`PRAGMA table_info("${tableName}")`));
    const pkCol = (pkResult.rows as any[]).find((column) => Number(column.pk) === 1)?.name ?? "id";

    const setClauses = fields.map((f) => {
      const val = updates[f];
      if (val === null) return `"${f}" = NULL`;
      if (typeof val === "string") return `"${f}" = '${val.replace(/'/g, "''")}'`;
      if (typeof val === "boolean") return `"${f}" = ${val}`;
      if (typeof val === "number") return `"${f}" = ${val}`;
      if (typeof val === "object") return `"${f}" = '${JSON.stringify(val).replace(/'/g, "''")}'`;
      return `"${f}" = '${String(val).replace(/'/g, "''")}'`;
    }).join(", ");

    await db.execute(sql.raw(`UPDATE "${tableName}" SET ${setClauses} WHERE "${pkCol}" = '${id}'`));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to update row" });
  }
});

router.delete("/db-viewer/tables/:tableName/rows", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const { tableName } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return void res.status(400).json({ error: "Invalid table name" });
  const { ids } = req.body as { ids: (string | number)[] };
  if (!Array.isArray(ids) || ids.length === 0) return void res.status(400).json({ error: "ids array required" });

  const safeIds = ids.map((id) => (typeof id === "number" ? id : `'${String(id).replace(/'/g, "''")}'`)).join(", ");

  try {
    const pkResult = await db.execute(sql.raw(`PRAGMA table_info("${tableName}")`));
    const pkCol = (pkResult.rows as any[]).find((column) => Number(column.pk) === 1)?.name ?? "id";

    const result = await db.execute(sql.raw(`DELETE FROM "${tableName}" WHERE "${pkCol}" IN (${safeIds})`));
    res.json({ success: true, deleted: (result as any).rowCount ?? ids.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to delete rows" });
  }
});

export default router;
