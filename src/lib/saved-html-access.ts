import type { DefaultTreeAdapterTypes } from "parse5";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value;
const auxiliary = new Set(["aside", "nav", "footer", "template"]);
const auxiliaryRoles = new Set(["complementary", "navigation", "contentinfo"]);

export function savedHtmlElementHidden(node: Element) {
  return attr(node, "hidden") !== undefined || attr(node, "inert") !== undefined
    || /(?:^|\s)(?:hidden|sr-only|visually-hidden|d-none)(?:\s|$)/iu.test(attr(node, "class") ?? "")
    || attr(node, "aria-hidden")?.toLowerCase() === "true"
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)\s*(?:!important\s*)?(?:;|$)/iu.test(attr(node, "style") ?? "");
}

export function savedHtmlBrowserLabel(value: string) {
  return /^(?:ваш браузер устарел|браузер не поддерживается|(?:your )?browser is (?:out of date|outdated|not supported)|unsupported browser|update your browser(?: to continue)?)[.!… ]*(?:\|\s*[^|]+)?$/iu
    .test(value.replace(/\s+/gu, " ").trim());
}

export function savedHtmlAccessLabel(value: string) {
  const label = value.replace(/\s+/gu, " ").trim();
  return savedHtmlBrowserLabel(label)
    || /^(?:sign[ -]?in|log[ -]?in|authentication required|вход|авторизация)(?:\s*[|–—:]|\s*$)/iu.test(label)
    || /^(?:just a moment|checking your browser|verify (?:that )?you (?:are|’re|'re) human|access denied|forbidden|permission denied|page not found|service unavailable|проверка безопасности|доступ (?:запрещ[её]н|ограничен)|страница не найдена|сервис временно недоступен|подтвердите,? что вы (?:человек|не робот))[.!… ]*(?:\|\s*[^|]+)?$/iu.test(label)
    || /^(?:error\s+)?(?:401|403|404|451|503)(?:\s*[-–—:]?\s*(?:unauthorized|forbidden|not found|unavailable for legal reasons|service unavailable))?$/iu.test(label);
}

function elementText(node: Element, checkTime?: () => void) {
  const parts: string[] = [];
  const pending = [...node.childNodes].reverse();
  while (pending.length) {
    checkTime?.();
    const child = pending.pop()!;
    if ("value" in child) parts.push(child.value);
    if ("tagName" in child && !["script", "style", "template"].includes(child.tagName) && !savedHtmlElementHidden(child)) {
      for (let i = child.childNodes.length - 1; i >= 0; i--) pending.push(child.childNodes[i]);
    }
  }
  return parts.join("");
}

function strongAccessGate(node: Element) {
  const markers = [attr(node, "id"), attr(node, "class"), attr(node, "src")].filter(Boolean).join(" ");
  if (/(?:^|[^\w])(?:paywall|metered[-_]wall|g-recaptcha|h-captcha|hcaptcha|cf-turnstile|cf-challenge|challenge-form|challenge-platform|captcha)(?:[^\w]|$)/iu.test(markers)) return true;
  if (attr(node, "data-paywall") !== undefined && attr(node, "data-paywall") !== "false") return true;
  return node.tagName === "script" && attr(node, "type")?.toLowerCase() === "application/ld+json"
    && node.childNodes.some(child => "value" in child && /"isAccessibleForFree"\s*:\s*(?:false|"false")/iu.test(child.value));
}

export function savedHtmlAccessGate(document: Parent, checkTime?: () => void) {
  const pending = [{ node: document, auxiliary: false }];
  while (pending.length) {
    checkTime?.();
    const current = pending.pop()!;
    const { node } = current;
    const outside = current.auxiliary || ("tagName" in node && (
      auxiliary.has(node.tagName) || auxiliaryRoles.has(attr(node, "role") ?? "") || savedHtmlElementHidden(node)
    ));
    if ("tagName" in node) {
      if (strongAccessGate(node)) return true;
      // An optional sign-in form may sit next to a completely public article.
      if (!outside && ((node.tagName === "input" && attr(node, "type")?.toLowerCase() === "password")
        || ((node.tagName === "title" || node.tagName === "h1") && savedHtmlAccessLabel(elementText(node, checkTime))))) return true;
      if (node.tagName === "meta" && (attr(node, "property") ?? attr(node, "name"))?.toLowerCase() === "og:title"
        && savedHtmlAccessLabel(attr(node, "content") ?? "")) return true;
    }
    for (const child of node.childNodes) {
      if ("tagName" in child) pending.push({ node: child, auxiliary: outside });
    }
  }
  return false;
}

export function savedHtmlLoginUrl(url: URL) {
  return /^(?:\/(?:accounts|auth))?\/(?:login|signin|log-in|sign-in|checkpoint|captcha)(?:[/.]|$)/iu.test(url.pathname);
}
