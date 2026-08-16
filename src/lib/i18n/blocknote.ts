import { ru } from "@blocknote/core/locales";
import { t } from "./messages";

export const notebookBlockNoteDictionary = {
  ...ru,
  placeholders: {
    ...ru.placeholders,
    default: t("editor.placeholder"),
  },
};
