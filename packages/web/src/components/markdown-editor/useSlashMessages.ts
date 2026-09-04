import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { SlashCommandMessages } from "../slashCommandExtension";

export function useMarkdownEditorSlashMessages(): SlashCommandMessages {
  const t = useTranslations("markdownEditor");

  return useMemo(
    () => ({
      header: t("slash.header"),
      escapeHint: t("slash.escapeHint"),
      sections: {
        text: t("slash.sections.text"),
        lists: t("slash.sections.lists"),
        structure: t("slash.sections.structure"),
      },
      footer: {
        navigation: t("slash.footer.navigation"),
        insert: t("slash.footer.insert"),
        close: t("slash.footer.close"),
      },
      empty: t("slash.empty"),
      commands: {
        heading1: {
          label: t("slash.commands.heading1.label"),
          description: t("slash.commands.heading1.description"),
        },
        heading2: {
          label: t("slash.commands.heading2.label"),
          description: t("slash.commands.heading2.description"),
        },
        heading3: {
          label: t("slash.commands.heading3.label"),
          description: t("slash.commands.heading3.description"),
        },
        quote: {
          label: t("slash.commands.quote.label"),
          description: t("slash.commands.quote.description"),
        },
        bulletList: {
          label: t("slash.commands.bulletList.label"),
          description: t("slash.commands.bulletList.description"),
        },
        numberedList: {
          label: t("slash.commands.numberedList.label"),
          description: t("slash.commands.numberedList.description"),
        },
        taskList: {
          label: t("slash.commands.taskList.label"),
          description: t("slash.commands.taskList.description"),
        },
        table: {
          label: t("slash.commands.table.label"),
          description: t("slash.commands.table.description"),
        },
        codeBlock: {
          label: t("slash.commands.codeBlock.label"),
          description: t("slash.commands.codeBlock.description"),
        },
        divider: {
          label: t("slash.commands.divider.label"),
          description: t("slash.commands.divider.description"),
        },
      },
    }),
    [t],
  );
}
