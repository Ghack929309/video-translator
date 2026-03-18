import { useState, useEffect, useCallback, useRef } from "react";

interface TranslationStatus {
  id: string;
  status: string;
  currentStep: string | null;
  progress: number;
  errorMessage: string | null;
  errorStep: string | null;
  resultVideoKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface UsePollingOptions {
  translationId: string;
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * Poll the translation status endpoint every N seconds.
 * Automatically stops when the translation reaches a terminal state.
 */
export function usePolling({
  translationId,
  intervalMs = 3000,
  enabled = true,
}: UsePollingOptions) {
  const [data, setData] = useState<TranslationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTerminal = data?.status === "COMPLETED" || data?.status === "FAILED";

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${translationId}/status`);
      if (!res.ok) {
        setError("Failed to fetch status");
        return;
      }
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      setError(null);
    } catch {
      setError("Network error");
    }
  }, [translationId]);

  useEffect(() => {
    if (!enabled || isTerminal) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Fetch immediately on mount
    fetchStatus();

    intervalRef.current = setInterval(fetchStatus, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isTerminal, fetchStatus, intervalMs]);

  return { data, error, isTerminal, refetch: fetchStatus };
}
