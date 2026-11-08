import { modusText } from "../../../../shared/modus-text";
import { isModusModelId } from "../../lib/modelPickerModels";

/**
 * A saved legacy Modus model cannot be used. Keep it selected until the user chooses another.
 */
export function ModusUnavailableNotice({
  modelIds,
}: {
  modelIds: readonly (string | null | undefined)[];
}) {
  if (!modelIds.some(isModusModelId)) return null;
  return (
    <div
      className="mb-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-fg-muted text-xs"
      data-testid="modus-unavailable-notice"
      role="status"
    >
      {modusText("modus.modelNotFound")}
    </div>
  );
}
