/** Copy retained only for saved models from the removed Modus provider. */
import { type GroupRoomLocale, resolveGroupRoomLocale } from "./group-room-locale";

export const MODUS_TEXT_EN = {
  "modus.modelNotFound": "This model is no longer available. Choose another provider.",
} as const;
export type ModusTextKey = keyof typeof MODUS_TEXT_EN;
export const MODUS_TEXT_PT: Record<ModusTextKey, string> = {
  "modus.modelNotFound": "Este modelo não está mais disponível. Escolha outro provedor.",
};
export const MODUS_TEXT_ZH: Record<ModusTextKey, string> = {
  "modus.modelNotFound": "此模型已不可用。请选择其他提供商。",
};

export const MODUS_TEXT: Record<GroupRoomLocale, Record<ModusTextKey, string>> = {
  en: MODUS_TEXT_EN,
  pt: MODUS_TEXT_PT,
  zh: MODUS_TEXT_ZH,
};

/** Modus copy for `key`; pt* → pt, zh* → zh, anything else (or no tag) → en. */
export function modusText(
  key: ModusTextKey,
  locale?: string | null,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const template = MODUS_TEXT[resolveGroupRoomLocale(locale)][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
