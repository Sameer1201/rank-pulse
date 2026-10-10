import { Router, type IRouter } from "express";
import { executeD1Sql } from "@workspace/db";
import { getSignedUserId } from "../lib/authUtils";

const router: IRouter = Router();

function getUser(req: any) {
  const userId = getSignedUserId(req);
  const userRole = req.cookies?.userRole ?? null;
  return { userId, userRole };
}

router.get("/analytics", async (req, res): Promise<void> => {
  const { userId, userRole } = getUser(req);
  if (!userId || (userRole !== "admin" && userRole !== "super_admin")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const allTests = (await executeD1Sql(`SELECT id, title FROM tests`, [])).rows as Record<string, unknown>[];
  const testIds = allTests.map((t) => Number(t.id ?? 0)).filter(Boolean);
  const testSubs = testIds.length
    ? (await executeD1Sql(
      `SELECT student_id AS studentId, test_id AS testId, score, total_points AS totalPoints, passed FROM test_submissions WHERE test_id IN (${testIds.map(() => "?").join(",")})`,
      testIds,
    )).rows as Record<string, unknown>[]
    : [];

  const completedSubs = testSubs.filter((s) => s.score !== null && s.totalPoints !== null && Number(s.totalPoints ?? 0) > 0);
  const avgScore = completedSubs.length > 0
    ? Math.round(completedSubs.reduce((sum, s) => sum + ((Number(s.score!) / Number(s.totalPoints!)) * 100), 0) / completedSubs.length)
    : 0;
  const passedSubs = testSubs.filter((s) => Boolean(s.passed)).length;
  const passRate = testSubs.length > 0 ? Math.round((passedSubs / testSubs.length) * 100) : 0;

  const ranges = [
    { range: "0–20%", min: 0, max: 20, count: 0 },
    { range: "21–40%", min: 21, max: 40, count: 0 },
    { range: "41–60%", min: 41, max: 60, count: 0 },
    { range: "61–80%", min: 61, max: 80, count: 0 },
    { range: "81–100%", min: 81, max: 100, count: 0 },
  ];
  for (const s of completedSubs) {
    const pct = (Number(s.score!) / Number(s.totalPoints!)) * 100;
    const bucket = ranges.find((r) => pct >= r.min && pct <= r.max);
    if (bucket) bucket.count++;
  }
  const scoreDistribution = ranges.map(({ range, count }) => ({ range, count }));

  const testMetrics = allTests.map((t) => {
    const testId = Number(t.id ?? 0);
    const subs = testSubs.filter((s) => Number(s.testId ?? 0) === testId);
    const scored = subs.filter((s) => s.score !== null && s.totalPoints && Number(s.totalPoints) > 0);
    const avg = scored.length > 0
      ? Math.round(scored.reduce((sum, s) => sum + (Number(s.score!) / Number(s.totalPoints!)) * 100, 0) / scored.length)
      : null;
    const pass = subs.length > 0 ? Math.round((subs.filter((s) => s.passed).length / subs.length) * 100) : null;
    return { id: testId, title: String(t.title ?? ""), totalSubmissions: subs.length, avgScore: avg, passRate: pass };
  });

  const scoreByStudent = new Map<number, { total: number; count: number }>();
  for (const s of completedSubs) {
    const pct = (Number(s.score!) / Number(s.totalPoints!)) * 100;
    const studentId = Number(s.studentId ?? 0);
    const ex = scoreByStudent.get(studentId) ?? { total: 0, count: 0 };
    ex.total += pct; ex.count += 1;
    scoreByStudent.set(studentId, ex);
  }
  const rankedStudents = [...scoreByStudent.entries()]
    .map(([id, v]) => ({ id, avg: Math.round(v.total / v.count) }))
    .sort((a, b) => b.avg - a.avg);

  const topIds = rankedStudents.slice(0, 8).map((s) => s.id);
  const bottomIds = rankedStudents.slice(-5).reverse().map((s) => s.id);
  const allFetchIds = [...new Set([...topIds, ...bottomIds])];
  const studentUsers = allFetchIds.length
    ? (await executeD1Sql(
        `SELECT id, full_name AS fullName, username FROM users WHERE id IN (${allFetchIds.map(() => "?").join(",")})`,
        allFetchIds,
      )).rows as Array<{ id: number; fullName: string; username: string }>
    : [];

  const topStudents = topIds.map((id) => ({
    ...(studentUsers.find((u) => Number(u.id ?? 0) === id) ?? { id, fullName: "", username: "" }),
    avgScore: rankedStudents.find((s) => s.id === id)!.avg,
  })).filter((s) => s.id);
  const bottomStudents = bottomIds.map((id) => ({
    ...(studentUsers.find((u) => Number(u.id ?? 0) === id) ?? { id, fullName: "", username: "" }),
    avgScore: rankedStudents.find((s) => s.id === id)!.avg,
  })).filter((s) => s.id);

  res.json({
    summary: {
      totalTests: allTests.length,
      totalSubmissions: testSubs.length,
      avgScore, passRate,
    },
    scoreDistribution,
    testMetrics,
    topStudents,
    bottomStudents,
  });
});

export default router;
