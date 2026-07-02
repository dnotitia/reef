"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import type { ExternalRef, ImplementationRef } from "@reef/core";
import {
  Check,
  Copy,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Link2,
  Plus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ISSUE_SECTION_HEADER_CLASS } from "../shared/IssueFormSection";

interface IssueRefsEditorProps {
  externalRefs: readonly ExternalRef[];
  implementationRefs: readonly ImplementationRef[];
  onExternalRefsChange: (refs: ExternalRef[]) => void;
  onImplementationRefsChange?: (refs: ImplementationRef[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}

// `document` is intentionally absent: akb document references now live in the
// "Linked documents" section as akb-native `references` relation edges
// (REEF-083). just non-akb references remain here.
const EXTERNAL_REF_TYPES: ExternalRef["type"][] = [
  "github_issue",
  "linear",
  "slack",
  "jira",
  "confluence",
  "url",
  "other",
];

const IMPLEMENTATION_REF_TYPES: ImplementationRef["type"][] = [
  "pull_request",
  "commit",
  "branch",
];

// Shared trailing-action shell: the controls stay in the DOM (so they keep
// keyboard focus and screen-reader access) but just reveal on hover/focus,
// keeping the row calm at rest. `shrink-0` guarantees they are not pushed off
// or overlapped by a long ref in the flexible middle zone (REEF-071).
const ROW_ACTIONS_CLASS =
  "flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

function ImplementationIcon({ type }: { type: ImplementationRef["type"] }) {
  if (type === "pull_request")
    return <GitPullRequest className="h-3.5 w-3.5 shrink-0" />;
  if (type === "branch") return <GitBranch className="h-3.5 w-3.5 shrink-0" />;
  return <GitCommit className="h-3.5 w-3.5 shrink-0" />;
}

function isSafeWebUrl(url: string): boolean {
  try {
    const scheme = new URL(url).protocol;
    return scheme === "http:" || scheme === "https:";
  } catch {
    return false;
  }
}

/**
 * Copy the full, untruncated value to the clipboard. Display rows truncate long
 * refs/titles for layout, so this is the guaranteed path back to the original
 * value (REEF-071: truncate for display just, does not the stored value).
 * Transient "copied" state is isolated here so toggling it re-renders just this
 * button, not the whole editor (which holds the edit-form input state).
 */
function CopyButton({
  value,
  label,
  disabled,
}: {
  value: string;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations("issues.refs");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function handleCopy() {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      aria-label={
        copied ? t("copiedLabel", { label }) : t("copyLabel", { label })
      }
      disabled={disabled}
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function DeliveryActivityRow({
  refItem,
  canEdit,
  disabled,
  onRemove,
}: {
  refItem: ImplementationRef;
  canEdit: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("issues.refs");
  const safeUrl = refItem.url && isSafeWebUrl(refItem.url) ? refItem.url : null;
  // Display just: short commit SHAs follow the git convention; other types keep
  // the full ref and rely on CSS truncation so a meaningful branch/PR name is
  // does not hard-sliced. The original ref stays intact for the title + copy.
  const displayRef =
    refItem.type === "commit" ? refItem.ref.slice(0, 7) : refItem.ref;

  const refChip = (
    <span
      className="max-w-[16ch] shrink-0 truncate rounded border border-border-subtle px-1 font-mono tabular-nums"
      title={refItem.ref}
    >
      {displayRef}
    </span>
  );
  const titleNode = refItem.title ? (
    <span className="min-w-0 flex-1 truncate" title={refItem.title}>
      {refItem.title}
    </span>
  ) : null;

  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md bg-surface-subtle px-2 py-1 text-xs">
      <ImplementationIcon type={refItem.type} />
      {safeUrl ? (
        <a
          href={safeUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2 hover:text-foreground hover:underline"
        >
          {refChip}
          {titleNode}
        </a>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {refChip}
          {titleNode}
        </span>
      )}
      <div className={ROW_ACTIONS_CLASS}>
        <CopyButton
          value={refItem.ref}
          label={t("reference")}
          disabled={disabled}
        />
        {canEdit && (
          <button
            type="button"
            aria-label={t("removeDeliveryActivity")}
            disabled={disabled}
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ExternalRefRow({
  refItem,
  typeLabel,
  disabled,
  onRemove,
}: {
  refItem: ExternalRef;
  typeLabel: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("issues.refs");
  const safeUrl =
    refItem.url && isSafeWebUrl(refItem.url)
      ? refItem.url
      : refItem.ref && isSafeWebUrl(refItem.ref)
        ? refItem.ref
        : null;
  const label = refItem.label ?? refItem.url ?? refItem.ref ?? "";
  const copyValue = refItem.url ?? refItem.ref ?? label;

  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md bg-surface-subtle px-2 py-1 text-xs">
      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-muted-foreground">{typeLabel}</span>
      {safeUrl ? (
        <a
          href={safeUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate hover:text-foreground hover:underline"
          title={label}
        >
          {label}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
      )}
      <div className={ROW_ACTIONS_CLASS}>
        {copyValue && (
          <CopyButton
            value={copyValue}
            label={t("reference")}
            disabled={disabled}
          />
        )}
        <button
          type="button"
          aria-label={t("removeExternalReference")}
          disabled={disabled}
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function IssueRefsEditor({
  externalRefs,
  implementationRefs,
  onExternalRefsChange,
  onImplementationRefsChange,
  disabled = false,
  idPrefix = "issue-refs",
}: IssueRefsEditorProps) {
  const t = useTranslations("issues.refs");
  const fieldNames = useFieldNameLabels();
  const externalTypeLabels: Record<ExternalRef["type"], string> = {
    github_issue: t("typeGithubIssue"),
    // Brand names render verbatim in every locale.
    linear: "Linear",
    slack: "Slack",
    jira: "Jira",
    confluence: "Confluence",
    url: t("url"),
    other: t("typeOther"),
  };
  const implementationTypeLabels: Record<ImplementationRef["type"], string> = {
    pull_request: t("typePullRequest"),
    commit: t("typeCommit"),
    branch: t("typeBranch"),
  };
  const [externalType, setExternalType] = useState<ExternalRef["type"]>("url");
  const [externalLabel, setExternalLabel] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [implementationType, setImplementationType] =
    useState<ImplementationRef["type"]>("pull_request");
  const [implementationRef, setImplementationRef] = useState("");
  const [implementationUrl, setImplementationUrl] = useState("");
  const [implementationTitle, setImplementationTitle] = useState("");

  const canEditImplementationRefs = Boolean(onImplementationRefsChange);

  function addExternalRef() {
    const trimmedRef = externalRef.trim();
    const trimmedLabel = externalLabel.trim();
    if (!trimmedRef && !trimmedLabel) return;
    onExternalRefsChange([
      ...externalRefs,
      {
        type: externalType,
        ref: trimmedRef || trimmedLabel,
        ...(trimmedRef && isSafeWebUrl(trimmedRef) ? { url: trimmedRef } : {}),
        ...(trimmedLabel ? { label: trimmedLabel } : {}),
      },
    ]);
    setExternalLabel("");
    setExternalRef("");
  }

  function removeExternalRef(index: number) {
    onExternalRefsChange(externalRefs.filter((_, i) => i !== index));
  }

  function addImplementationRef() {
    if (!onImplementationRefsChange) return;
    const trimmedRef = implementationRef.trim();
    if (!trimmedRef) return;
    const trimmedUrl = implementationUrl.trim();
    const trimmedTitle = implementationTitle.trim();
    onImplementationRefsChange([
      ...implementationRefs,
      {
        type: implementationType,
        ref: trimmedRef,
        ...(trimmedUrl ? { url: trimmedUrl } : {}),
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      },
    ]);
    setImplementationRef("");
    setImplementationUrl("");
    setImplementationTitle("");
  }

  function removeImplementationRef(index: number) {
    onImplementationRefsChange?.(
      implementationRefs.filter((_, i) => i !== index),
    );
  }

  const showImplementationSection =
    canEditImplementationRefs || implementationRefs.length > 0;

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h3 className={ISSUE_SECTION_HEADER_CLASS}>{t("deliveryLinks")}</h3>

      {showImplementationSection && (
        <div className="grid min-w-0 gap-2">
          <h4 className="text-xs font-semibold text-foreground">
            {t("deliveryActivity")}
          </h4>

          {implementationRefs.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              {implementationRefs.map((ref, index) => (
                <DeliveryActivityRow
                  key={`${ref.type}:${ref.repo ?? ""}:${ref.ref}:${index}`}
                  refItem={ref}
                  canEdit={canEditImplementationRefs}
                  disabled={disabled}
                  onRemove={() => removeImplementationRef(index)}
                />
              ))}
            </div>
          )}

          {canEditImplementationRefs && (
            <div className="grid min-w-0 gap-2">
              <div className="grid min-w-0 gap-2 sm:grid-cols-[132px_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    id={`${idPrefix}-implementation-type-label`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("activityKind")}
                  </span>
                  <Select
                    value={implementationType}
                    disabled={disabled}
                    onValueChange={(value) =>
                      setImplementationType(value as ImplementationRef["type"])
                    }
                  >
                    <SelectTrigger
                      aria-labelledby={`${idPrefix}-implementation-type-label`}
                    >
                      <SelectValue placeholder={t("kind")} />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPLEMENTATION_REF_TYPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {implementationTypeLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`${idPrefix}-implementation-ref`}
                  >
                    {t("activityReference")}
                  </label>
                  <Input
                    id={`${idPrefix}-implementation-ref`}
                    value={implementationRef}
                    disabled={disabled}
                    placeholder={t("activityRefPlaceholder")}
                    onChange={(e) => setImplementationRef(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`${idPrefix}-implementation-url`}
                  >
                    {t("url")}
                  </label>
                  <Input
                    id={`${idPrefix}-implementation-url`}
                    value={implementationUrl}
                    disabled={disabled}
                    placeholder={t("optionalUrl")}
                    onChange={(e) => setImplementationUrl(e.target.value)}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`${idPrefix}-implementation-title`}
                  >
                    {t("activityTitle")}
                  </label>
                  <Input
                    id={`${idPrefix}-implementation-title`}
                    value={implementationTitle}
                    disabled={disabled}
                    placeholder={t("optionalTitle")}
                    onChange={(e) => setImplementationTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addImplementationRef();
                      }
                    }}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !implementationRef.trim()}
                onClick={addImplementationRef}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("addActivity")}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid min-w-0 gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {t("externalReferences")}
        </h4>

        {externalRefs.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            {externalRefs.map((ref, index) => (
              <ExternalRefRow
                key={`${ref.type}:${ref.ref ?? ref.url ?? index}`}
                refItem={ref}
                typeLabel={externalTypeLabels[ref.type]}
                disabled={disabled}
                onRemove={() => removeExternalRef(index)}
              />
            ))}
          </div>
        )}

        <div className="grid min-w-0 gap-2 sm:grid-cols-[132px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-1">
            <span
              id={`${idPrefix}-external-type-label`}
              className="text-xs font-medium text-muted-foreground"
            >
              {t("referenceKind")}
            </span>
            <Select
              value={externalType}
              disabled={disabled}
              onValueChange={(value) =>
                setExternalType(value as ExternalRef["type"])
              }
            >
              <SelectTrigger
                aria-labelledby={`${idPrefix}-external-type-label`}
              >
                <SelectValue placeholder={t("kind")} />
              </SelectTrigger>
              <SelectContent>
                {EXTERNAL_REF_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {externalTypeLabels[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor={`${idPrefix}-external-ref`}
            >
              {t("externalReference")}
            </label>
            <Input
              id={`${idPrefix}-external-ref`}
              value={externalRef}
              disabled={disabled}
              placeholder={t("urlOrReference")}
              onChange={(e) => setExternalRef(e.target.value)}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={`${idPrefix}-external-label`}
          >
            {fieldNames.title}
          </label>
          <Input
            id={`${idPrefix}-external-label`}
            value={externalLabel}
            disabled={disabled}
            placeholder={t("optionalLabel")}
            onChange={(e) => setExternalLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExternalRef();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || (!externalRef.trim() && !externalLabel.trim())}
          onClick={addExternalRef}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("addReference")}
        </Button>
      </div>
    </section>
  );
}
