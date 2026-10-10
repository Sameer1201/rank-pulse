import { api } from "./api";
import type { OfflineQuestion, BufferQuestionLoader } from "./offline-practice";
import type { StudentQuestionBankQuestion, QuestionImageData } from "@/pages/student/question-bank/api";

export async function loadOfflineQBank(chapterId: number, ids: number[], exam: string, signal?: AbortSignal,onReady?:Parameters<BufferQuestionLoader>[2]): Promise<OfflineQuestion[]> {
  const {questions} = await api.get<{questions:StudentQuestionBankQuestion[]}>(`/question-bank/chapters/${chapterId}/questions?questionIds=${ids.slice(0,15).join(",")}`,{networkOnly:true,signal});
  // Keep downloads bounded, including the separately stored question/option diagrams.
  const result: OfflineQuestion[] = [];
  for (const id of ids.slice(0,15)) {
    const q = questions.find(item=>item.id===id);
    if (!q) continue;
    const images = q.hasImage || q.hasOptionImages ? await api.get<QuestionImageData>(`/question-bank/questions/${id}/image`,{networkOnly:true,signal}) : undefined;
    const ready:OfflineQuestion={view:{difficulty:q.difficulty,points:q.points,topicTag:q.topicTag,isSaved:q.isSaved,progress:q.progress},id:q.id,exam,question:q.question,questionType:q.questionType,options:q.options,
      imageData:images?.imageData??q.imageData,optionImages:images?.optionImages??q.optionImages,
      correctAnswer:q.correctAnswer,correctAnswerMulti:q.correctAnswerMulti,answerText:q.answer,
      answerMin:q.correctAnswerMin,answerMax:q.correctAnswerMax,explanation:q.explanation,
      timeSpentSeconds:q.timeSpentSeconds,attempted:(q.progress?.attemptCount??0)>0};
    result.push(ready);
    await onReady?.(ready);
  }
  return result;
}
