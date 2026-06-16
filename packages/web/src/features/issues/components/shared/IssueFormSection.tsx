/**
 * old-shape alias. The section grouping is now a shared component
 * (`@/components/FormSection`) used by both issue and planning form surfaces.
 * Existing issue imports keep working unchanged via these re-exports.
 */
export {
  FormSection as IssueFormSection,
  SECTION_HEADER_CLASS as ISSUE_SECTION_HEADER_CLASS,
} from "@/components/FormSection";
