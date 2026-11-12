import { useState } from "react";
import { modelThinkingOptions, selectedThinkingOption } from "../../lib/modelThinking";
import { useShellText } from "../../lib/shellText";
import { Composer, type ComposerProps } from "./Composer";
import { isPickableModel } from "./SessionModelPicker";

type HomeComposerProps = Omit<
  ComposerProps,
  "branchControl" | "model" | "onSubmit" | "selectors"
> & {
  /** App default model from Settings; "" when none is configured. */
  defaultModelId: string;
  /** Model picked for the first message; "" = follow the app default. */
  heroModel: string;
  onHeroModelChange(modelId: string): void;
  onSubmit(
    ...args: [...Parameters<ComposerProps["onSubmit"]>, thinkingVariant?: string]
  ): ReturnType<ComposerProps["onSubmit"]>;
};

/**
 * Home (hero) composer: there is no chat yet, so the model comes from the host-held
 * pick or the app default. The model chip is the only way to make it sendable when no
 * default is configured, so it is wired here rather than left to the host.
 */
export function HomeComposer({
  defaultModelId,
  heroModel,
  onHeroModelChange,
  onSubmit,
  models,
  ...rest
}: HomeComposerProps) {
  const t = useShellText();
  const modelId = heroModel || defaultModelId;
  const model = models.find((item) => item.id === modelId);
  const options = model && isPickableModel(models, modelId) ? modelThinkingOptions(model) : [];
  const [effort, setEffort] = useState<{ modelId: string; value: string }>();
  const selected =
    effort?.modelId === modelId
      ? options.find((option) => option.value === effort.value)
      : undefined;
  const current = model && (selected ?? selectedThinkingOption(model));

  return (
    <Composer
      {...rest}
      selectors={{
        modelLabel:
          model && isPickableModel(models, modelId)
            ? heroModel
              ? model.name
              : t("shell.modelDefault", { name: model.name })
            : t("shell.pickModel"),
        onModelChange: (next) => {
          if (next !== modelId) setEffort(undefined);
          onHeroModelChange(next);
        },
        efforts: options.length > 1 ? options : [],
        effort: current?.value,
        onEffortChange: (value) => setEffort({ modelId, value }),
      }}
      model={modelId}
      onSubmit={(...args) => (selected ? onSubmit(...args, selected.value) : onSubmit(...args))}
      models={models}
    />
  );
}
