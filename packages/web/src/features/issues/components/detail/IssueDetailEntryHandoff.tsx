"use client";

import { createContext, useContext, type ReactNode } from "react";

const IssueDetailEntryHandoffContext = createContext<(() => void) | null>(null);

export function IssueDetailEntryHandoffProvider({
  onReady,
  children,
}: {
  onReady: () => void;
  children: ReactNode;
}) {
  return (
    <IssueDetailEntryHandoffContext.Provider value={onReady}>
      {children}
    </IssueDetailEntryHandoffContext.Provider>
  );
}

export function useIssueDetailEntryHandoff() {
  return useContext(IssueDetailEntryHandoffContext);
}
