import { classifySavedLink } from "./saved-link";
import { metadataUrl } from "./saved-metadata-network";
import { deviceCaptureDetailsSchema, type DeviceCaptureInput } from "./saved-item-validation";

export function captureCanonicalUrl(original: string, value?: string) {
  if (!value) return undefined;
  try {
    const candidate = metadataUrl(value);
    const source = metadataUrl(original);
    if (source.protocol === "https:" && candidate.protocol !== "https:") return undefined;
    const host = (url: URL) => url.hostname.replace(/^www\.|\.$/gu, "");
    const a = classifySavedLink(source);
    const b = classifySavedLink(candidate);
    if (a.kind === "video" && a.provider === "youtube") {
      if (b.kind !== "video" || b.provider !== "youtube" || !a.videoId || a.videoId !== b.videoId) return undefined;
    } else if (host(source) !== host(candidate)) return undefined;
    candidate.hash = "";
    return candidate.href;
  } catch { return undefined; }
}

export function captureContentType(
  original: string, input: Pick<DeviceCaptureInput, "contentType" | "provenance">,
): NonNullable<DeviceCaptureInput["contentType"]> {
  const link = classifySavedLink(original);
  if (link.kind !== "article") return link.kind;
  if (input.contentType === "product" && input.provenance?.contentType === "schema") return "product";
  if (input.contentType === "video" && (input.provenance?.contentType === "opengraph" || input.provenance?.contentType === "schema")) return "video";
  return "article";
}

export function captureDetails(value: unknown) {
  const parsed = deviceCaptureDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
