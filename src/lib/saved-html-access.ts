import type { DefaultTreeAdapterTypes } from "parse5";

type Element = DefaultTreeAdapterTypes.Element;
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value;

export function savedHtmlElementHidden(node: Element) {
  return attr(node, "hidden") !== undefined || attr(node, "inert") !== undefined
    || /(?:^|\s)(?:hidden|sr-only|visually-hidden|d-none)(?:\s|$)/iu.test(attr(node, "class") ?? "")
    || attr(node, "aria-hidden")?.toLowerCase() === "true"
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)\s*(?:!important\s*)?(?:;|$)/iu.test(attr(node, "style") ?? "");
}

export function savedHtmlAccessGate(node: Element) {
  const markers = [attr(node, "id"), attr(node, "class"), attr(node, "src")].filter(Boolean).join(" ");
  if (/(?:^|[^\w])(?:paywall|metered[-_]wall|g-recaptcha|h-captcha|hcaptcha|cf-turnstile|cf-challenge|challenge-form|challenge-platform|captcha)(?:[^\w]|$)/iu.test(markers)) return true;
  if (attr(node, "data-paywall") !== undefined && attr(node, "data-paywall") !== "false") return true;
  if (node.tagName === "title" || node.tagName === "h1") {
    const label = node.childNodes.map(child => "value" in child ? child.value : "").join("").trim();
    if (/^(?:sign[ -]?in|log[ -]?in|authentication required|вход|авторизация)(?:\s*[|–—:]|\s*$)/iu.test(label)
      || /^(?:just a moment[. …]*|verify (?:that )?you (?:are|’re|'re) human|access denied)[.!…]*$/iu.test(label)) return true;
  }
  if (node.tagName === "input" && attr(node, "type")?.toLowerCase() === "password" && !savedHtmlElementHidden(node)) return true;
  return node.tagName === "script" && attr(node, "type")?.toLowerCase() === "application/ld+json"
    && node.childNodes.some(child => "value" in child && /"isAccessibleForFree"\s*:\s*(?:false|"false")/iu.test(child.value));
}
