import { desc } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  real,
  boolean,
  unique,
  index,
} from "./sqlite";
import { classesTable } from "./classes";
import { subjectsTable } from "./subjects";
import { chaptersTable } from "./chapters";
import { usersTable } from "./users";

export const questionBankQuestionsTable = pgTable("question_bank_questions", {
  id: serial("id").primaryKey(),
  classId: integer("class_id")
    .notNull()
    .references(() => classesTable.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chaptersTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  questionType: text("question_type").notNull().default("mcq"),
  options: text("options").notNull().default("[]"),
  optionImages: text("option_images"),
  correctAnswer: real("correct_answer"),
  correctAnswerMulti: text("correct_answer_multi"),
  correctAnswerMin: real("correct_answer_min"),
  correctAnswerMax: real("correct_answer_max"),
  answer: text("answer"),
  explanation: text("explanation"),
  topicTag: text("topic_tag"),
  difficulty: text("difficulty").notNull().default("medium"),
  points: integer("points").notNull().default(1),
  order: integer("order").notNull().default(0),
  imageData: text("image_data"),
  sourceTestId: integer("source_test_id"),
  sourceTestQuestionId: integer("source_test_question_id"),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("question_bank_questions_class_id_order_created_at_id_idx").on(t.classId, t.order, t.createdAt, t.id),
  index("question_bank_questions_chapter_id_order_created_at_id_idx").on(t.chapterId, t.order, t.createdAt, t.id),
  index("question_bank_questions_created_by_created_at_id_idx").on(t.createdBy, t.createdAt, t.id),
]);

export const questionBankReportsTable = pgTable("question_bank_reports", {
  id: serial("id").primaryKey(),
  questionId: integer("question_id")
    .notNull()
    .references(() => questionBankQuestionsTable.id, { onDelete: "cascade" }),
  classId: integer("class_id")
    .notNull()
    .references(() => classesTable.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chaptersTable.id, { onDelete: "cascade" }),
  reportedBy: integer("reported_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("question_bank_reports_question_id_created_at_id_idx").on(t.questionId, t.createdAt, t.id),
  index("question_bank_reports_teacher_id_created_at_id_idx").on(t.teacherId, t.createdAt, t.id),
  index("question_bank_reports_teacher_id_status_created_at_id_idx").on(t.teacherId, t.status, t.createdAt, t.id),
  index("question_bank_reports_created_at_id_idx").on(desc(t.createdAt), desc(t.id)),
]);

export const questionBankSavedQuestionsTable = pgTable(
  "question_bank_saved_questions",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questionBankQuestionsTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }, (t) => [
    index("question_bank_saved_questions_student_id_question_id_idx").on(t.studentId, t.questionId),
    index("question_bank_saved_questions_student_id_created_at_id_idx").on(t.studentId, t.createdAt, t.id),
  ],
);

export const questionBankQuestionProgressTable = pgTable(
  "question_bank_question_progress",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questionBankQuestionsTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    classId: integer("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjectsTable.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chaptersTable.id, { onDelete: "cascade" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    lastAnswer: text("last_answer"),
    lastIsCorrect: boolean("last_is_correct").notNull().default(false),
    firstAttemptedAt: timestamp("first_attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
  },
  (t) => [
    unique("question_bank_question_progress_unique").on(
      t.questionId,
      t.studentId,
    ),
    index("question_bank_question_progress_student_id_last_attempted_at_id_idx").on(t.studentId, t.lastAttemptedAt, t.id),
    index("question_bank_question_progress_student_id_class_id_id_idx").on(t.studentId, t.classId, t.id),
  ],
);

export type QuestionBankQuestion =
  typeof questionBankQuestionsTable.$inferSelect;
export type QuestionBankReport = typeof questionBankReportsTable.$inferSelect;
export type QuestionBankSavedQuestion =
  typeof questionBankSavedQuestionsTable.$inferSelect;
export type QuestionBankQuestionProgress =
  typeof questionBankQuestionProgressTable.$inferSelect;
