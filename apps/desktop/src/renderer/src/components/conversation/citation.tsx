import * as React from "react";
import { cx } from "./citation-utils/cx";

export type CitationProps = React.HTMLAttributes<HTMLSpanElement> & {
  index?: number | undefined;
  source?: string | undefined;
  title?: string | undefined;
  href?: string | undefined;
};

export function Citation(props: CitationProps) {
  const Component = props.href ? "a" : "span";
  const label = props.title ?? props.source;

  return React.createElement(
    Component,
    { ...props, className: cx("rr-cite", !props.href && "rr-cite--static", props.className) },
    props.index !== undefined && <span className="rr-cite__index">{props.index}</span>,
    label && <span className="rr-cite__source">{label}</span>,
  );
}
