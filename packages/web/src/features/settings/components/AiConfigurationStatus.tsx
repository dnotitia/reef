"use client";

import { useAiAvailable } from "@/features/settings/hooks/useAiAvailable";

export function AiConfigurationStatus() {
  const { isAvailable, isLoading, model, provider } = useAiAvailable();
  const providerLabel = provider === "openrouter" ? "OpenRouter" : provider;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Checking AI status…</p>;
  }

  if (!isAvailable) {
    return (
      <div className="rounded-md border border-status-in-progress/40 bg-status-in-progress/5 px-3 py-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">AI is not configured.</p>
        <p>
          This deployment needs an OpenRouter API key before AI features are
          available.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-full bg-status-done" />
      <span>{`${providerLabel} · ${model ?? "configured"}`}</span>
    </div>
  );
}
