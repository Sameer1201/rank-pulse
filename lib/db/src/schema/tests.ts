import { pgTable, text, serial, timestamp, integer, boolean, real, unique, index } from "./sqlite";
import { usersTable } from "./users";
import { chaptersTable } from "./chapters";
import { questionBankQuestionsTable } from "./question_bank";

export const testsTable = pgTable("tests", {
  id: serial("id").primaryKey(),
  classId: integer("class_id"),
  chapterId: integer("chapter_id").references(() => chaptersTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  examType: text("exam_type").notNull().default("custom"),
  examHeader: text("exam_header"),
  examSubheader: text("exam_subheader"),
  instructions: text("instructions"),
  examConfig: text("exam_config"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  passingScore: integer("passing_score"),
  defaultPositiveMarks: real("default_positive_marks").notNull().default(1),
  defaultNegativeMarks: real("default_negative_marks").notNull().default(0),
  isPublished: boolean("is_published").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("tests_created_by_idx").on(t.createdBy),
  index("tests_display_order_idx").on(t.displayOrder),
  index("tests_is_published_idx").on(t.isPublished),
]);

export const testSectionsTable = pgTable("test_sections", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => testsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  subjectLabel: text("subject_label"),
  questionCount: integer("question_count"),
  marksPerQuestion: real("marks_per_question"),
  negativeMarks: real("negative_marks"),
  meta: text("meta"),
  order: integer("order").notNull().default(0),
}, (t) => [
  index("test_sections_test_id_order_id_idx").on(t.testId, t.order, t.id),
]);

export const testQuestionsTable = pgTable("test_questions", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => testsTable.id, { onDelete: "cascade" }),
  sectionId: integer("section_id").references(() => testSectionsTable.id, { onDelete: "set null" }),
  question: text("question").notNull(),
  questionType: text("question_type").notNull().default("mcq"),
  questionCode: text("question_code"),
  sourceType: text("source_type").notNull().default("manual"),
  subjectLabel: text("subject_label"),
  options: text("options").notNull().default("[]"),
  optionImages: text("option_images"),
  correctAnswer: real("correct_answer").notNull().default(0),
  correctAnswerMulti: text("correct_answer_multi"),
  correctAnswerMin: real("correct_answer_min"),
  correctAnswerMax: real("correct_answer_max"),
  points: integer("points").notNull().default(1),
  negativeMarks: real("negative_marks").notNull().default(0),
  meta: text("meta"),
  solutionText: text("solution_text"),
  solutionImageData: text("solution_image_data"),
  aiSolutionText: text("ai_solution_text"),
  order: integer("order").notNull().default(0),
  imageData: text("image_data"),
}, (t) => [
  index("test_questions_test_id_order_id_idx").on(t.testId, t.order, t.id),
]);

export const testSubmissionsTable = pgTable("test_submissions", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => testsTable.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => usersTable.id),
  answers: text("answers").notNull(),
  questionTimings: text("question_timings"),
  flaggedQuestions: text("flagged_questions"),
  visitedQuestionIds: text("visited_question_ids"),
  reviewQuestionIds: text("review_question_ids"),
  interactionLog: text("interaction_log"),
  score: real("score").notNull().default(0),
  totalPoints: integer("total_points").notNull().default(0),
  percentage: real("percentage").notNull().default(0),
  passed: boolean("passed").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("test_submissions_student_id_submitted_at_id_idx").on(t.studentId, t.submittedAt, t.id),
  index("test_submissions_test_id_submitted_at_id_idx").on(t.testId, t.submittedAt, t.id),
  index("test_submissions_test_id_student_id_submitted_at_id_idx").on(t.testId, t.studentId, t.submittedAt, t.id),
]);

export const testQuestionReportsTable = pgTable("test_question_reports", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => testsTable.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => testQuestionsTable.id, { onDelete: "cascade" }),
  reportedBy: integer("reported_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  teacherNote: text("teacher_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("test_question_reports_test_id_reported_by_created_at_id_idx").on(t.testId, t.reportedBy, t.createdAt, t.id),
  index("test_question_reports_reported_by_question_id_created_at_id_idx").on(t.reportedBy, t.questionId, t.createdAt, t.id),
]);

export const testQuestionBankLinksTable = pgTable("test_question_bank_links", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => testsTable.id, { onDelete: "cascade" }),
  testQuestionId: integer("test_question_id").notNull().references(() => testQuestionsTable.id, { onDelete: "cascade" }),
  questionBankQuestionId: integer("question_bank_question_id").notNull().references(() => questionBankQuestionsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("test_question_bank_links_test_question_unique").on(t.testQuestionId),
]);

export type Test = typeof testsTable.$inferSelect;
export type TestSection = typeof testSectionsTable.$inferSelect;
export type TestQuestion = typeof testQuestionsTable.$inferSelect;
export type TestSubmission = typeof testSubmissionsTable.$inferSelect;
export type TestQuestionReport = typeof testQuestionReportsTable.$inferSelect;
export type TestQuestionBankLink = typeof testQuestionBankLinksTable.$inferSelect;
