/** Provider grouping shared by all model pickers, with unavailable saved values preserved. */

/** Legacy model IDs use `modus/<provider>/<id>`. */
export const MODUS_MODEL_PREFIX = "modus/";

const MODUS_PROVIDER_ID = "modus";

export function isModusModelId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(MODUS_MODEL_PREFIX);
}

export type PickableModel = {
  id: string;
  name: string;
  /** Registry provider id (ModelInfo.provider); else the `<providerId>/` id prefix. */
  provider?: string | undefined;
  /** The provider's name as Settings › Providers shows it (ModelInfo.providerName). */
  providerName?: string | undefined;
};

export type ModelPickerGroup<M extends PickableModel = PickableModel> = {
  /** Registry provider id, e.g. for ProviderLogo. */
  providerId: string;
  label: string;
  models: M[];
};

export type ModelPickerGroups<M extends PickableModel = PickableModel> = {
  /** Options outside any group, before the groups: the saved model that is no longer listed. */
  loose: { id: string; label: string }[];
  groups: ModelPickerGroup<M>[];
};

/**
 * Whether the model came from the Modus router catalog. Decided by origin (ModelInfo.provider,
 * the registry provider), not by the id: a Modus model's router id can equal a bundled/BYOK id
 * (`deepseek/deepseek-flash`). The `modus/` prefix is only a fallback when provider is missing.
 */
export function isModusModel(model: PickableModel): boolean {
  return model.provider ? model.provider === MODUS_PROVIDER_ID : isModusModelId(model.id);
}

/** The removed account provider must never be offered, including in stale catalogs. */
export function isHiddenPickerModel(model: PickableModel): boolean {
  return isModusModel(model);
}

/** The models a picker offers (and that a draft may pick), in the given order. */
export function selectableModels<M extends PickableModel>(models: readonly M[]): M[] {
  return models.filter((model) => !isHiddenPickerModel(model));
}

function providerIdOf(model: PickableModel): string {
  if (model.provider) return model.provider;
  const slash = model.id.indexOf("/");
  return slash > 0 ? model.id.slice(0, slash) : model.id;
}

/**
 * The picker content groups models by provider, alphabetical by display name, with the given
 * order kept inside a group, and keeps `savedModelId` as a loose "(unavailable)" option
 * when it is not among the listed models. Callers render their own placeholder /
 * "App default" option before `loose`.
 */
export function buildModelPickerGroups<M extends PickableModel>(
  models: readonly M[],
  savedModelId?: string | null,
): ModelPickerGroups<M> {
  const visible = selectableModels(models);
  const byProvider = new Map<string, ModelPickerGroup<M>>();
  for (const model of visible) {
    const providerId = providerIdOf(model);
    let group = byProvider.get(providerId);
    if (!group) {
      const label = model.providerName || providerId;
      group = { providerId, label, models: [] };
      byProvider.set(providerId, group);
    }
    group.models.push(model);
  }
  const groups = [...byProvider.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.providerId.localeCompare(b.providerId),
  );
  const loose: ModelPickerGroups<M>["loose"] = [];
  if (savedModelId && !visible.some((model) => model.id === savedModelId)) {
    const known = models.find((model) => model.id === savedModelId);
    loose.push({ id: savedModelId, label: `${known?.name ?? savedModelId} (unavailable)` });
  }
  return { loose, groups };
}

/** `<option>` / `<optgroup>` output for model pickers that intentionally use a native select. */
export function ModelOptions({
  models,
  savedModelId,
}: {
  models: readonly PickableModel[];
  savedModelId?: string | null | undefined;
}) {
  const { loose, groups } = buildModelPickerGroups(models, savedModelId);
  return (
    <>
      {loose.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
      {groups.map((group) => (
        <optgroup data-provider={group.providerId} key={group.providerId} label={group.label}>
          {group.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
