import { useMemo, useRef, useState } from "react";
import type { ModelInfo, ThinkingOption } from "../../../../shared/contracts";
import { isHiddenPickerModel, selectableModels } from "../../lib/modelPickerModels";
import { modelThinkingOptions, selectedThinkingOption } from "../../lib/modelThinking";
import { useShellText } from "../../lib/shellText";

export type ComposerSelectors = {
  modelLabel?: string;
  onModelChange(model: string): void;
  efforts: readonly ThinkingOption[];
  effort?: string | undefined;
  onEffortChange(effort: string): void;
  disabled?: boolean;
  disabledReason?: string | undefined;
};

export function isPickableModel(models: readonly ModelInfo[], modelId: string): boolean {
  const model = models.find((item) => item.id === modelId);
  return Boolean(model && !isHiddenPickerModel(model) && model.available && model.enabled);
}

export function usePromptBarModels(models: readonly ModelInfo[]) {
  return useMemo(
    () =>
      selectableModels(models.filter((model) => model.available && model.enabled)).map((model) => ({
        key: model.id,
        name: model.name,
        tag: model.providerName ?? model.provider,
      })),
    [models],
  );
}

export function useSessionComposerSelectors({
  sessionId,
  storedModelId,
  defaultModelId,
  models,
  modelsReady,
  isRunning,
  onError,
  onChanged,
}: {
  sessionId: string;
  storedModelId: string | undefined;
  defaultModelId: string;
  models: ModelInfo[];
  modelsReady: boolean;
  isRunning: boolean;
  onError(message: string): void;
  onChanged(): void | Promise<void>;
}) {
  const t = useShellText();
  const effectiveId = storedModelId || defaultModelId;
  const blocked = modelsReady && Boolean(effectiveId) && !isPickableModel(models, effectiveId);
  const effective = models.find((model) => model.id === effectiveId);
  const options = !blocked && effective ? modelThinkingOptions(effective) : [];
  const [effort, setEffort] = useState<{ sessionId: string; modelId: string; value: string }>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const runningReason = t("shell.modelRunning");

  async function save(model: string, thinkingVariant?: string): Promise<void> {
    if (isRunning || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await window.modus.agent.setModel({
        sessionId,
        model,
        ...(thinkingVariant ? { thinkingVariant } : {}),
      });
      setEffort(
        thinkingVariant ? { sessionId, modelId: model, value: thinkingVariant } : undefined,
      );
      await onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(
        message.includes("Can't change the model while a run is active.") ? runningReason : message,
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const savedEffort =
    effort?.sessionId === sessionId && effort.modelId === effectiveId
      ? options.find((option) => option.value === effort.value)
      : undefined;
  const defaultName = models.find((model) => model.id === defaultModelId)?.name ?? defaultModelId;
  const modelLabel =
    blocked || !effectiveId
      ? t("shell.pickModel")
      : storedModelId
        ? (effective?.name ?? storedModelId)
        : t("shell.modelDefault", { name: defaultName });
  const selectors: ComposerSelectors = {
    modelLabel,
    onModelChange: (next) => {
      if (next !== storedModelId) void save(next);
    },
    efforts: options.length > 1 ? options : [],
    effort: (savedEffort ?? (effective ? selectedThinkingOption(effective) : undefined))?.value,
    onEffortChange: (next) => void save(effectiveId, next),
    disabled: isRunning || saving,
    disabledReason: isRunning ? runningReason : undefined,
  };

  return { blocked: blocked || saving, selectors };
}
