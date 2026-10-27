"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ListChecks } from "lucide-react";
import { checklistProgress, formatStickerLine, replaceStickerLine, stickerLines, toggleStickerLine } from "@/lib/sticker-checklist";

export type StickerEditorHandle = { focus(): void };
export const StickerBodyEditor = forwardRef<StickerEditorHandle, {
  value: string; onChange(value: string, immediate?: boolean): void; onBlur?(): void;
  onSubmit?(): void; autoFocus?: boolean; placeholder?: string;
}>(function StickerBodyEditor({ value, onChange, onBlur, onSubmit, autoFocus, placeholder }, ref) {
  const plain = useRef<HTMLTextAreaElement | null>(null);
  const fields = useRef(new Map<number, HTMLTextAreaElement>());
  const caret = useRef<number | null>(null);
  const active = useRef({ index: 0, offset: 0 });
  const lines = stickerLines(value);
  const progress = checklistProgress(value);
  useImperativeHandle(ref, () => ({ focus: () => { (plain.current ?? fields.current.get(active.current.index) ?? fields.current.get(0))?.focus(); } }), []);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    const position = caret.current;caret.current = null;
    if (plain.current) { plain.current.focus();plain.current.setSelectionRange(position, position);return; }
    const rows = stickerLines(value);
    const index = Math.max(0, rows.findLastIndex(line => line.start <= position));
    const field = fields.current.get(index);
    const offset = Math.max(0, position - rows[index]!.start - rows[index]!.prefix.length);
    field?.focus();field?.setSelectionRange(offset, offset);
  }, [value]);
  function edit(next: string, position: number, immediate = false) {
    if (next.length > 10_000) return;
    caret.current = position;onChange(next, immediate);
  }
  function keys(event: KeyboardEvent<HTMLTextAreaElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) { event.preventDefault();onSubmit();return; }
    const line = lines[index]!;
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    if (event.key === "Enter") {
      event.preventDefault();
      const prefix = line.checked === null ? "" : "- [ ] ";
      const newline = value.slice(line.end).startsWith("\r\n") ? "\r\n" : "\n";
      const text = line.text.slice(0, start) + newline + prefix + line.text.slice(end);
      edit(replaceStickerLine(value, index, text), line.start + line.prefix.length + start + newline.length + prefix.length);
    } else if (event.key === "Backspace" && start === 0 && end === 0) {
      if (line.checked !== null) { event.preventDefault();edit(formatStickerLine(value, index), line.start); }
      else if (index > 0) { event.preventDefault();const previous = lines[index - 1]!;edit(value.slice(0, previous.end) + line.text + value.slice(line.end), previous.end); }
    }
  }
  function format() {
    const index = plain.current ? Math.max(0, lines.findLastIndex(line => line.start <= plain.current!.selectionStart)) : active.current.index;
    const line = lines[index] ?? lines[0]!;
    const offset = plain.current ? plain.current.selectionStart - line.start : active.current.offset;
    edit(formatStickerLine(value, index), line.start + (line.checked === null ? 6 : 0) + Math.min(offset, line.text.length));
  }
  return <div className="sticker-body-editor min-w-0">
    <div className="flex min-h-9 items-center justify-between gap-2 text-xs"><button type="button" className="flex min-h-11 items-center gap-1.5 rounded px-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onMouseDown={event => event.preventDefault()} onClick={format}><ListChecks size={16}/>Чек-лист</button>{progress.total > 0 && <span aria-label="Выполнено пунктов">{progress.done}/{progress.total}</span>}</div>
    {!progress.total ? <textarea ref={plain} autoFocus={autoFocus} aria-label="Текст стикера" value={value} maxLength={10_000} rows={5} placeholder={placeholder} className="w-full resize-none bg-transparent text-base leading-6 outline-none" onChange={event => edit(event.target.value, event.target.selectionStart)} onBlur={onBlur} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault();onSubmit?.(); } }}/>
      : <div className="sticker-editor-lines max-h-64 overflow-y-auto overscroll-contain">{lines.map((line, index) => <div key={index} className="sticker-checklist-line flex min-w-0 items-start" data-checked={line.checked === true}>
        {line.checked !== null && <label className="sticker-checkbox-target flex shrink-0 items-center justify-center" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={line.text || "Пустой пункт"} checked={line.checked} onChange={() => onChange(toggleStickerLine(value, index), true)}/></label>}
        <LineInput value={line.text} inputRef={node => { if (node) fields.current.set(index, node);else fields.current.delete(index); }} autoFocus={autoFocus && index === 0} maxLength={10_000 - value.length + line.text.length} label={line.checked === null ? "Строка стикера" : "Текст пункта"} onFocus={offset => { active.current = { index, offset }; }} onChange={(text, offset) => { active.current = { index, offset };edit(replaceStickerLine(value, index, text), line.start + line.prefix.length + offset); }} onBlur={onBlur} onKeyDown={event => keys(event, index)}/>
      </div>)}</div>}
  </div>;
});

function LineInput({ value, inputRef, autoFocus, maxLength, label, onFocus, onChange, onBlur, onKeyDown }: {
  value: string; inputRef(node: HTMLTextAreaElement | null): void; autoFocus?: boolean; maxLength: number; label: string;
  onFocus(offset: number): void; onChange(value: string, offset: number): void; onBlur?(): void; onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => { const node = ref.current;if (node) { node.style.height = "auto";node.style.height = `${Math.min(144, Math.max(44, node.scrollHeight))}px`; } }, [value]);
  return <textarea ref={node => { ref.current = node;inputRef(node); }} autoFocus={autoFocus} aria-label={label} rows={1} maxLength={maxLength} value={value} className="min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" onFocus={event => onFocus(event.target.selectionStart)} onSelect={event => onFocus(event.currentTarget.selectionStart)} onChange={event => onChange(event.target.value, event.target.selectionStart)} onBlur={onBlur} onKeyDown={onKeyDown}/>;
}

export function StickerChecklistPreview({ body, onToggle }: { body: string; onToggle(index: number): void }) {
  const lines = stickerLines(body);
  const progress = checklistProgress(body);
  if (!progress.total) return <span className="block line-clamp-2 whitespace-pre-line text-sm leading-5">{body}</span>;
  return <div className="sticker-checklist-preview text-sm">{lines.slice(0, 5).map((line, index) => line.checked === null ? <p key={index} className="line-clamp-1 min-h-2 whitespace-pre-wrap break-words">{line.text}</p> : <label key={index} className="sticker-checkbox-target pointer-events-auto relative z-10 flex items-center gap-2" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={line.text || "Пустой пункт"} checked={line.checked} onChange={() => onToggle(index)}/><span className={line.checked ? "line-clamp-1 line-through opacity-60" : "line-clamp-1"}>{line.text || "Пустой пункт"}</span></label>)}<span className="mt-1 block text-xs" aria-label="Выполнено пунктов">{progress.done}/{progress.total}{lines.length > 5 ? " · …" : ""}</span></div>;
}
