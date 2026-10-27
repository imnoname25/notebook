"use client";
import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import type { TextMatch } from "@/lib/document-search";

/** A presentation mirror: the controlled input and its value remain unchanged. */
export function SearchTitle({ matches, active, enabled, theme, ...props }: InputHTMLAttributes<HTMLInputElement> & { matches: TextMatch[]; active: number; enabled: boolean; theme?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (!input.current || !mirror.current) return;
      const style = getComputedStyle(input.current);
      Object.assign(mirror.current.style, { font: style.font, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, padding: style.padding });
      const mark = mirror.current.querySelector<HTMLElement>(".notebook-search-current");
      mirror.current.scrollLeft = mark ? Math.max(0, mark.offsetLeft - input.current.clientWidth / 2) : 0;
      input.current.scrollLeft = mirror.current.scrollLeft;
    };
    measure();const observer = new ResizeObserver(measure);if (input.current) observer.observe(input.current);
    return () => observer.disconnect();
  }, [matches, active, theme, props.value]);
  if (!enabled) return <input {...props}/>;
  const text = String(props.value ?? "");
  const parts = matches.map((match, index) => { const before = text.slice(matches[index - 1]?.to ?? 0, match.from);return <span key={index}>{before}<mark className={index === active ? "notebook-search-match notebook-search-current" : "notebook-search-match"}>{text.slice(match.from, match.to)}</mark></span>; });
  return <div className="notebook-title-search-host" data-highlight={matches.length > 0}><input {...props} ref={input} onScroll={event => { if (mirror.current) mirror.current.scrollLeft = event.currentTarget.scrollLeft;props.onScroll?.(event); }}/><div ref={mirror} className="notebook-title-search-mirror" aria-hidden="true">{parts}{text.slice(matches.at(-1)?.to ?? 0)}</div></div>;
}
