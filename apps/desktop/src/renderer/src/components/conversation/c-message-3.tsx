import type { ReactNode } from "react";
import { Bubble, BubbleContent } from "./bubble";
import { Message, MessageContent, MessageFooter, MessageHeader } from "./message";

export function MessageWithHeader({
  align = "start",
  author,
  time,
  footer,
  children,
  ...props
}: {
  align?: "start" | "end";
  author: string;
  time?: string | undefined;
  footer?: ReactNode;
  children: ReactNode;
} & React.ComponentProps<"div">) {
  return (
    <Message align={align} {...props}>
      <MessageContent>
        <MessageHeader className="gap-1.5">
          {author}
          {time && (
            <>
              <span
                aria-hidden="true"
                className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
              />
              <span className="tabular-nums">{time}</span>
            </>
          )}
        </MessageHeader>
        <Bubble align={align} variant="muted" className="w-full max-w-full">
          <BubbleContent className="w-full overflow-visible">{children}</BubbleContent>
        </Bubble>
        {footer && <MessageFooter>{footer}</MessageFooter>}
      </MessageContent>
    </Message>
  );
}
