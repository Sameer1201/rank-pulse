import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export function useQuestionReport(endpoint: string, open: boolean, onSent: () => void, exam?: string) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const key = ["student-question-report", user?.id, endpoint, exam ?? ""];
  // Read only when opening the report dialog, never for every practice question.
  // Always revalidate on reopening so admin responses unlock reporting promptly.
  const status = useQuery({
    queryKey: key,
    enabled: open && Boolean(user?.id),
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => api.get<{ pending: boolean }>(`${endpoint}${exam ? `?exam=${encodeURIComponent(exam)}` : ""}`, { networkOnly: true, signal }),
  });
  const mutation = useMutation({
    mutationFn: ({ reason }: { questionId?: number; reason: string }) => api.post(endpoint, { reason, ...(exam ? { exam } : {}) }),
    onSuccess: () => {
      queryClient.setQueryData(key, { pending: true });
      onSent();
      toast({ title: "Report submitted", description: "Please wait for an admin response before reporting this question again." });
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) queryClient.setQueryData(key, { pending: true });
      toast({ title: error.status === 409 ? "Already reported" : "Could not send report", description: error.message, variant: "destructive" });
    },
  });
  return {
    mutation,
    blocked: status.isFetching || !status.data || status.isError || status.data.pending,
    message: status.isFetching ? "Checking report status…" : status.isError
      ? "Could not check report status. Close and reopen to retry."
      : status.data?.pending ? "Already reported — waiting for an admin response." : "",
  };
}
