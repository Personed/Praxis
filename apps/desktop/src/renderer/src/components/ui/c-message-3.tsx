import type { ComponentProps, ReactNode } from "react";
import { Bubble, BubbleContent } from "./c-message-3-utils/bubble";
import { Message, MessageContent, MessageFooter, MessageHeader } from "./c-message-3-utils/message";

export function ConversationMessage({
  align = "start",
  author,
  time,
  status,
  footer,
  bubbleProps,
  children,
  ...props
}: {
  align?: "start" | "end";
  author?: string;
  time?: string | undefined;
  status?: ReactNode;
  footer?: ReactNode;
  bubbleProps?: ComponentProps<"div">;
  children: ReactNode;
} & ComponentProps<"div">) {
  return (
    <Message align={align} {...props}>
      <MessageContent>
        {author ? (
          <MessageHeader className="gap-1.5">
            {author}
            {(time || status) && (
              <>
                <span
                  aria-hidden="true"
                  className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                />
                {status ?? <span className="tabular-nums">{time}</span>}
              </>
            )}
          </MessageHeader>
        ) : null}
        <Bubble
          align={align}
          variant={align === "end" ? "default" : "muted"}
          className="w-full max-w-full"
        >
          <BubbleContent {...bubbleProps} className="w-full overflow-visible">
            {children}
          </BubbleContent>
        </Bubble>
        {footer && <MessageFooter>{footer}</MessageFooter>}
      </MessageContent>
    </Message>
  );
}

export function Pattern() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-7">
      <Message>
        <MessageContent>
          <MessageHeader className="gap-1.5">
            Emma Wilson
            <span
              aria-hidden="true"
              className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
            />
            <span className="tabular-nums">09:38</span>
          </MessageHeader>
          <Bubble variant="muted">
            <BubbleContent>
              The invoice template is missing the VAT line on EU orders.
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <Bubble>
            <BubbleContent>
              Fixed on the 4.2 branch. It ships with tonight&apos;s release.
            </BubbleContent>
          </Bubble>
          <MessageFooter>Read 09:41</MessageFooter>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <MessageHeader className="gap-1.5">
            Emma Wilson
            <span
              aria-hidden="true"
              className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
            />
            <span className="tabular-nums">09:42</span>
          </MessageHeader>
          <Bubble variant="muted">
            <BubbleContent>Then I will re-run the January batch once it is out.</BubbleContent>
          </Bubble>
          <MessageFooter className="gap-1.5">
            <span>Edited</span>
            <span
              aria-hidden="true"
              className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
            />
            <span className="tabular-nums">09:44</span>
          </MessageFooter>
        </MessageContent>
      </Message>
    </div>
  );
}

export default Pattern;
