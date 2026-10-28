"use client";
import { Fragment, useState, type ReactNode } from "react";
import { EDITOR_BLOCK_TYPES } from "@/lib/editor-compatibility";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function inline(value: unknown): ReactNode {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  return value.map((raw, index) => {
    const node = object(raw);const props = object(node.props);
    if (node.type === "pageLink") return <span key={index} className="history-internal-link" title={`pageId: ${String(props.pageId)}`}>{String(props.text || "Страница недоступна")}</span>;
    if (node.type === "link") return <span key={index} className="history-internal-link" title={String(node.href ?? "")}>{inline(node.content)}</span>;
    if (node.type !== "text") return <code key={index}>{JSON.stringify(node)}</code>;
    const styles = object(node.styles);let text: ReactNode = String(node.text ?? "");
    if (styles.bold) text = <strong>{text}</strong>;if (styles.italic) text = <em>{text}</em>;if (styles.underline) text = <u>{text}</u>;if (styles.strike) text = <s>{text}</s>;if (styles.code) text = <code>{text}</code>;
    return <Fragment key={index}>{text}</Fragment>;
  });
}
export function HistoryBlockView({ block }: { block: Record<string, unknown> }) {
  const [rawOpen, setRawOpen] = useState(false);
  const type = String(block.type ?? "unknown");const props = object(block.props);const text = inline(block.content);
  let view: ReactNode = text;
  if (!EDITOR_BLOCK_TYPES.some(item => item === type)) view = <><p>Неизвестный тип: {type}. Данные сохранены.</p><p>Полное содержимое доступно в JSON блока.</p></>;
  else if (type === "heading") view = <div role="heading" aria-level={Math.max(1, Math.min(6, Number(props.level) || 1))} className="history-heading">{text}</div>;
  else if (type === "checkListItem") view = <div className="history-check"><input type="checkbox" disabled checked={Boolean(props.checked)} aria-label="Состояние исторического пункта"/><span className={props.checked ? "line-through" : ""}>{text}</span></div>;
  else if (type === "bulletListItem" || type === "numberedListItem") view = <div className="history-check"><span aria-hidden="true">{type === "bulletListItem" ? "•" : `${String(props.start ?? "1")}.`}</span><span>{text}</span></div>;
  else if (type === "quote") view = <blockquote>{text}</blockquote>;
  else if (type === "codeBlock") view = <><small>{String(props.language || "text")}</small><pre><code>{text}</code></pre></>;
  else if (type === "callout" || type === "banner") view = <blockquote><strong>{String(props.title || props.kind || "Информация")}</strong><div>{text}</div></blockquote>;
  else if (type === "table") {
    const table = object(block.content);const rows = Array.isArray(table.rows) ? table.rows : [];
    view = <div className="history-table-scroll"><table><tbody>{rows.map((raw, rowIndex) => { const row = object(raw);const cells = Array.isArray(row.cells) ? row.cells : [];return <tr key={rowIndex}>{cells.map((rawCell, cellIndex) => { const cell = object(rawCell);const cellProps = object(cell.props);return <td key={cellIndex} colSpan={Math.max(1, Math.min(50, Number(cellProps.colspan) || 1))} rowSpan={Math.max(1, Math.min(50, Number(cellProps.rowspan) || 1))}>{inline(Array.isArray(rawCell) || typeof rawCell === "string" ? rawCell : cell.content)}</td>; })}</tr>; })}</tbody></table></div>;
  } else if (["image", "video", "audio", "file"].includes(type)) {
    const url = typeof props.url === "string" ? props.url : "";
    // Authenticated uploads only; historical content cannot trigger arbitrary remote requests.
    // eslint-disable-next-line @next/next/no-img-element
    view = <>{type === "image" && /^\/api\/uploads\/[A-Za-z0-9_-]+$/.test(url) ? <img src={url} alt={String(props.caption || props.name || "Историческое изображение")} loading="lazy"/> : <p>{String(props.name || props.caption || type)} {url}</p>}<small>{String(props.caption ?? "")}</small></>;
  } else if (type === "divider") view = <><hr/>{text}</>;
  else if (type === "liveWidget") view = <p>{String(props.title || "Live Widget")} · {String(props.targetLabel || "Историческое состояние; запросы не выполняются")}</p>;
  else if (type === "bookmark") view = <><strong>{String(props.title || props.url || "Закладка")}</strong><p>{String(props.description || props.url || "")}</p></>;
  else if (["tabs", "tabPanel", "columns", "columnPanel", "toggle", "toggleListItem", "tableOfContents", "pageVariables"].includes(type)) view = <><small>{String(props.label || props.title || type)}</small><div>{text}</div></>;
  return <div className="history-block-view">{view}<details className="history-raw" onToggle={event => setRawOpen(event.currentTarget.open)}><summary>JSON блока</summary>{rawOpen && <pre>{JSON.stringify(block, null, 2)}</pre>}</details></div>;
}
