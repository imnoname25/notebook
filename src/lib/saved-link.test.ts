import { expect, it } from "vitest";
import { classifySavedLink } from "./saved-link";

it.each([
  "https://youtube.com/watch?v=testVideo_1&t=15s",
  "https://www.youtube.com/shorts/testVideo_1",
  "https://m.youtube.com/live/testVideo_1",
  "https://music.youtube.com/watch?v=testVideo_1",
  "https://youtu.be/testVideo_1?si=tracking",
  "https://www.youtube-nocookie.com/embed/testVideo_1",
])("recognizes a YouTube video at %s", url => {
  expect(classifySavedLink(url)).toEqual({ kind: "video", provider: "youtube", videoId: "testVideo_1" });
});

it.each([
  "https://vk.com/clip-123_456",
  "https://m.vk.com/clip123_456",
  "https://vk.ru/clips/club123",
  "https://vkvideo.ru/clip-123_456",
  "https://vk.com/club123?z=clip-123_456%2Fclip_feed",
])("recognizes VK Clips at %s", url => {
  expect(classifySavedLink(url)).toEqual({ kind: "video", provider: "vk-clips" });
});

it.each([
  ["https://www.threads.net/@field.notes/post/Cabc123?xmt=tracking", "/@field.notes/post/Cabc123"],
  ["https://threads.com/t/Cabc123/", "/t/Cabc123/"],
])("recognizes a Threads post at %s", (url, postPath) => {
  expect(classifySavedLink(url)).toEqual({ kind: "social", provider: "threads", postPath });
});

it("keeps other URLs on the HTML path and recognizes provider links without a supported ID", () => {
  for (const url of ["https://club.dns-shop.ru/review/example", "https://vk.com/club123",
    "https://youtube.com.example.test/watch?v=testVideo_1", "https://example.test/@notes/post/Cabc123",
    "https://example.test/?source=threads.com", "https://vk.com.example.test/clip-123_456", "file:///clip-123_456"]) {
    expect(classifySavedLink(url)).toEqual({ kind: "article" });
  }
  expect(classifySavedLink("https://youtube.com/watch?v=invalid")).toEqual({ kind: "video", provider: "youtube", videoId: null });
  expect(classifySavedLink("https://threads.com/@notes")).toEqual({ kind: "social", provider: "threads", postPath: null });
});
