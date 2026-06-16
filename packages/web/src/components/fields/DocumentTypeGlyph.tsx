import { cn } from "@/lib/utils";
import {
  BookMarked,
  FileText,
  GitBranch,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  Notebook,
  Ruler,
  ScrollText,
  Sparkles,
  SquareCheck,
} from "lucide-react";

/**
 * Glyph for an akb document type (note / report / decision / spec / plan /
 * session / task / reference / skill). The SHAPE carries the distinction; reef
 * keeps the palette calm (restrained, not decorative), so the tone stays neutral and the
 * document card's structure — glyph + title + breadcrumb — is what sets a linked
 * document apart from a plain external URL row (REEF-083). Unknown/absent types
 * fall back to a generic document glyph.
 */
const DOC_TYPE_ICON: Record<string, LucideIcon> = {
  note: Notebook,
  report: ScrollText,
  decision: GitBranch,
  spec: Ruler,
  plan: ListChecks,
  session: MessagesSquare,
  task: SquareCheck,
  reference: BookMarked,
  skill: Sparkles,
};

const DOC_TYPE_LABELS: Record<string, string> = {
  note: "Note",
  report: "Report",
  decision: "Decision",
  spec: "Spec",
  plan: "Plan",
  session: "Session",
  task: "Task",
  reference: "Reference",
  skill: "Skill",
};

/** Human label for a doc type, defaulting to "Document" for unknown/absent. */
export function documentTypeLabel(docType: string | null | undefined): string {
  return (docType && DOC_TYPE_LABELS[docType]) || "Document";
}

interface DocumentTypeGlyphProps {
  docType?: string | null;
  className?: string;
}

export function DocumentTypeGlyph({
  docType,
  className,
}: DocumentTypeGlyphProps) {
  const Icon = (docType && DOC_TYPE_ICON[docType]) || FileText;
  return (
    <Icon
      className={cn("shrink-0 text-muted-foreground", className)}
      aria-hidden="true"
    />
  );
}
