export type SettingsSectionId =
  | "general"
  | "model-provider"
  | "appearance"
  | "personalization"
  | "skills"
  | "mcp"
  | "rules";

export type ModelConfigPatch = {
  thinkingVariant?: string;
  contextWindow?: number;
  maxTokens?: number;
};
