"use client";

import { DeleteLinkButton, EditLinkButton, LinkToolbar, OpenLinkButton, useComponentsContext, type LinkToolbarProps } from "@blocknote/react";
import { Copy } from "lucide-react";
import { useState } from "react";

export function NotebookLinkToolbar(props: LinkToolbarProps) {
  const Components = useComponentsContext()!;
  const [feedback, setFeedback] = useState("");
  const label = "Копировать адрес ссылки";
  return <LinkToolbar {...props}>
    <EditLinkButton {...props}/>
    <OpenLinkButton url={props.url}/>
    <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen}/>
    <Components.LinkToolbar.Button label={label} mainTooltip={label} icon={<Copy size={16}/>} onClick={async () => {
      try {
        await navigator.clipboard.writeText(props.url);
        setFeedback("Адрес скопирован");
      } catch {
        setFeedback("Не удалось скопировать адрес");
      }
    }}/>
    {feedback && <span role="status" className="sr-only">{feedback}</span>}
  </LinkToolbar>;
}
