import { cn } from "@/lib/utils";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useId,
} from "react";

export type EmptyStateVariant = "structure" | "section";

type StructureEmptyStateHTMLProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "title"
>;
type SectionEmptyStateHTMLProps = Omit<
  ComponentPropsWithoutRef<"section">,
  "title"
>;

interface StructureEmptyStateProps extends StructureEmptyStateHTMLProps {
  /** Use structure when the page cannot be composed without a prerequisite. */
  variant: "structure";
  /** Optional heading for a structure prompt. */
  title?: ReactNode;
  /** Optional supporting copy for a structure prompt. */
  description?: ReactNode;
}

interface SectionEmptyStateProps extends SectionEmptyStateHTMLProps {
  /** Section is the canonical framed variant and is the default. */
  variant?: "section";
  /** Required section heading, rendered as the single h2. */
  title: ReactNode;
  /** Required supporting copy, rendered as the supporting paragraph. */
  description: ReactNode;
}

export type EmptyStateProps =
  | StructureEmptyStateProps
  | SectionEmptyStateProps;

const SECTION_FRAME =
  "mx-auto h-48 min-h-48 w-full max-w-4xl rounded-lg border border-dashed border-border-subtle bg-surface-subtle px-6 py-12 text-center";
const STRUCTURE_FRAME =
  "flex flex-1 items-center justify-center px-6 py-12 text-center";

export function EmptyState({
  variant = "section",
  className,
  ...props
}: EmptyStateProps) {
  const id = useId();

  if (variant === "structure") {
    const { title, description, ...structureProps } = props;
    const hasTitle = title !== undefined && title !== null;
    const hasDescription = description !== undefined && description !== null;

    return (
      <div
        data-slot="empty-state"
        className={cn(STRUCTURE_FRAME, className)}
        {...structureProps}
      >
        <div className="flex flex-col items-center">
          {hasTitle ? (
            <h2 className="text-pretty text-sm font-semibold text-foreground">
              {title}
            </h2>
          ) : null}
          {hasDescription ? (
            <p
              className={cn(
                "text-pretty text-sm text-muted-foreground",
                hasTitle && "mt-1",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const { title, description, ...sectionProps } = props;

  return (
    <section
      data-slot="empty-state"
      className={cn(SECTION_FRAME, className)}
      {...sectionProps}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
    >
      <div className="flex flex-col items-center">
        <h2
          id={`${id}-title`}
          className="text-pretty text-sm font-semibold text-foreground"
        >
          {title}
        </h2>
        <p
          id={`${id}-description`}
          className="mt-1 text-pretty text-sm text-muted-foreground"
        >
          {description}
        </p>
      </div>
    </section>
  );
}
