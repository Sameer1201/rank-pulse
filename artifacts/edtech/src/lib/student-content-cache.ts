import type { QueryClient } from "@tanstack/react-query";

export async function invalidateStudentContentQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
    queryClient.invalidateQueries({ queryKey: ["current-user"] }),
    queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
    queryClient.invalidateQueries({ queryKey: ["leaderboard-panel"] }),
    queryClient.invalidateQueries({ queryKey: ["student-tests"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-tests"] }),
    queryClient.invalidateQueries({ queryKey: ["student-question-bank-exams"] }),
    queryClient.invalidateQueries({ queryKey: ["student-question-bank-exam"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-question-bank-exams"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-question-bank-exam"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-question-bank-progress"] }),
  ]);
}
