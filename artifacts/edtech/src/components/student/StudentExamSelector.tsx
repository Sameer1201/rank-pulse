import { useEffect, useMemo, useState } from "react";
import { FlaskConical, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentExamOptions, isJamChemistryExam, persistStudentExam, readStudentExamSelection, studentExamLabel } from "@/lib/student-exam-selection";

export default function StudentExamSelector() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const options = useMemo(() => getStudentExamOptions(user), [user]);
  const [selectedExam, setSelectedExam] = useState(() => readStudentExamSelection(user));

  useEffect(() => {
    const sync = () => setSelectedExam(readStudentExamSelection(user));
    window.addEventListener("student-exam-changed", sync);
    window.addEventListener("storage", sync);
    sync();
    return () => {
      window.removeEventListener("student-exam-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [user]);

  useEffect(() => {
    if (!options.length) return;
    if (!options.some((exam) => exam === selectedExam)) {
      setSelectedExam(options[0]);
      persistStudentExam(options[0]);
    }
  }, [options, selectedExam]);

  // A single-exam student should not see a redundant switcher in the top bar.
  // The selector becomes available automatically after the student adds another exam.
  if (!user || user.role !== "student" || options.length <= 1) return null;

  const handleChange = (exam: string) => {
    setSelectedExam(exam);
    persistStudentExam(exam);
    if (isJamChemistryExam(exam) && window.location.pathname.startsWith("/student/psu")) {
      setLocation("/student/dashboard");
    }
  };

  return (
    <label className="relative inline-flex min-w-0 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-orange-800 shadow-sm">
      <FlaskConical size={16} className="shrink-0" />
      <span className="hidden text-[10px] font-bold uppercase tracking-wide sm:inline">Exam</span>
      <select value={selectedExam} onChange={(event) => handleChange(event.target.value)} className="max-w-[10rem] appearance-none bg-transparent pr-5 text-sm font-semibold outline-none">
        {options.map((exam) => <option key={exam} value={exam}>{studentExamLabel(exam)}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 shrink-0" />
    </label>
  );
}
