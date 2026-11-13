type SavedLink =
  | { kind: "article" }
  | { kind: "video"; provider: "youtube"; videoId: string | null }
  | { kind: "video"; provider: "vk-clips" }
  | { kind: "social"; provider: "threads"; postPath: string | null };

const youtubeHosts = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"]);
const vkHosts = new Set(["vk.com", "m.vk.com", "vk.ru", "m.vk.ru", "vkvideo.ru", "m.vkvideo.ru"]);
const vkClipPath = /^\/(?:clip-?\d+_\d+\/?$|clips(?:\/|$))/u;
const threadsPostPath = /^\/(?:@[\w.]+\/post\/[\w-]+|t\/[\w-]+)\/?$/u;

export function classifySavedLink(value: string | URL): SavedLink {
  const url = typeof value === "string" ? URL.parse(value) : value;
  if (!url || !["http:", "https:"].includes(url.protocol)) return { kind: "article" };
  const host = url.hostname.replace(/^www\.|\.$/gu, "");
  const path = url.pathname;
  if (youtubeHosts.has(host)) {
    const id = host === "youtu.be" ? path.slice(1).replace(/\/$/u, "")
      : /^\/watch\/?$/u.test(path) ? url.searchParams.get("v")
      : path.match(/^\/(?:shorts|embed|live|v)\/([\w-]+)\/?$/u)?.[1];
    return { kind: "video", provider: "youtube", videoId: id && /^[\w-]{11}$/u.test(id) ? id : null };
  }
  if (vkHosts.has(host) && (vkClipPath.test(path) || /^clip-?\d+_\d+(?:\/|$)/u.test(url.searchParams.get("z") ?? ""))) {
    return { kind: "video", provider: "vk-clips" };
  }
  if (host === "threads.com" || host === "threads.net") {
    return { kind: "social", provider: "threads", postPath: threadsPostPath.test(path) ? path : null };
  }
  return { kind: "article" };
}
