import type { QueuedPromptItem } from "../../../../shared/contracts";
import { MessageQueue } from "../../components/conversation/message-queue";

/** One line of what the user typed: whitespace collapsed, truncated by CSS. */
export function queuedPromptPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Show the runtime queue above the composer in arrival order. */
export function QueuedPromptStrip({
  items,
  onRemove,
}: {
  items: QueuedPromptItem[];
  onRemove(id: string): void;
}) {
  if (items.length === 0) return null;
  return (
    <MessageQueue
      items={items.map((item) => ({
        id: item.id,
        content: queuedPromptPreview(item.text),
        attachments: item.imageCount,
      }))}
      onRemove={onRemove}
    />
  );
}
