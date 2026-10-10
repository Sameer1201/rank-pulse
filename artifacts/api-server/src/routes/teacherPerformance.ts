import { Router } from "express";
import {
  db,
  usersTable,
  testsTable,
  testSubmissionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getSignedUserId } from "../lib/authUtils";

const router = Router();

type TestSubmissionRow = typeof testSubmissionsTable.$inferSelect;

router.get("/teacher-performance", async (req, res): Promise<void> => {
  const userId = getSignedUserId(req);
  const userRole = req.cookies?.userRole;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (userRole !== "super_admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const teachers = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));

  if (teachers.length === 0) {
    res.json([]);
    return;
  }

  const teacherIds = teachers.map((teacher) => teacher.id);

  const allTests = teacherIds.length > 0
    ? await db.select().from(testsTable).where(inArray(testsTable.createdBy, teacherIds))
    : [];

  const testIds = allTests.map((test) => test.id);
  const testSubs = testIds.length > 0
    ? await db.select().from(testSubmissionsTable).where(inArray(testSubmissionsTable.testId, testIds))
    : [] as TestSubmissionRow[];

  const result = teachers.map((teacher) => {
    const myTests = allTests.filter((test) => test.createdBy === teacher.id);
    const myTestIds = myTests.map((test) => test.id);
    const myTestSubs = testSubs.filter((submission) => myTestIds.includes(submission.testId));

    const uniqueStudents = new Set(myTestSubs.map((submission) => submission.studentId)).size;

    const gradedSubs = myTestSubs.filter(
      (submission) => submission.score !== null && submission.totalPoints && submission.totalPoints > 0,
    );
    const avgScore = gradedSubs.length > 0
      ? Math.round(
          gradedSubs.reduce(
            (accumulator, submission) => accumulator + ((submission.score! / submission.totalPoints!) * 100),
            0,
          ) / gradedSubs.length,
        )
      : null;

    const rankingScore = Math.round(
      uniqueStudents * 3
      + myTests.length * 12
      + myTestSubs.length * 2
      + (avgScore ?? 0) / 4,
    );

    return {
      id: teacher.id,
      fullName: teacher.fullName,
      username: teacher.username,
      subject: teacher.subject ?? null,
      email: teacher.email ?? null,
      status: teacher.status,
      uniqueStudents,
      testsCount: myTests.length,
      testSubmissions: myTestSubs.length,
      avgScore,
      avgRating: null,
      feedbackCount: 0,
      rankingScore,
    };
  });

  result.sort((a, b) => b.rankingScore - a.rankingScore);

  res.json(result);
});

export { router as teacherPerformanceRouter };
