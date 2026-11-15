package ru.metroom.notebook;

import okhttp3.HttpUrl;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;

public class NotebookArticleCaptureTest {
    private static final byte[] JPEG = {(byte) 255, (byte) 216, (byte) 255, 1};

    @Test public void savesPikabuTextAndImagesInOrderWithOneHtmlRequest() throws Exception {
        var calls = new ArrayList<String>();
        var capture = reader(fixture("pikabu-story.html"), calls).get("https://pikabu.ru/story/test", true, true).article();
        assertNotNull(capture);
        assertEquals(List.of("/story/test", "/bridge.webp", "/map.webp"), calls);
        assertEquals(2, capture.images().size());
        var blocks = capture.payload().getJSONArray("blocks");
        var types = new ArrayList<String>();
        for (int i = 0; i < blocks.length(); i++) types.add(blocks.getJSONObject(i).getString("type"));
        assertEquals(List.of("heading", "paragraph", "image", "paragraph", "paragraph", "image", "paragraph"), types);
        assertEquals("Старый мост", blocks.getJSONObject(2).getString("alt"));
        assertEquals("Схема", blocks.getJSONObject(5).getString("alt"));
        assertFalse(capture.payload().toString().contains("author.webp"));
    }

    @Test public void keepsArticleLinksQuotesAndNestedListsAndRestoresBinarySnapshot() throws Exception {
        var calls = new ArrayList<String>();
        var preview = reader(fixture("ordered-article.html"), calls).get("https://example.org/story?edition=first", true, true);
        assertNotNull(preview.article());
        var blocks = preview.article().payload().getJSONArray("blocks");
        assertEquals("https://example.org/notes#map", blocks.getJSONObject(1).getJSONArray("content").getJSONObject(1).getString("href"));
        assertEquals("image", blocks.getJSONObject(3).getString("type"));
        assertEquals("quote", blocks.getJSONObject(5).getString("type"));
        assertEquals(1, blocks.getJSONObject(7).getInt("depth"));
        assertEquals("continuation", blocks.getJSONObject(8).getJSONArray("content").getJSONObject(0).getString("text"));
        assertEquals(List.of("/story", "/ridge.jpg"), calls);
        var snapshot = NotebookCapturedPreview.success(preview);
        var buffer = new ByteArrayOutputStream();
        snapshot.write(new DataOutputStream(buffer));
        var restored = NotebookCapturedPreview.read(new DataInputStream(new ByteArrayInputStream(buffer.toByteArray())));
        assertEquals(snapshot.payload().toString(), restored.payload().toString());
        assertArrayEquals(JPEG, restored.articleImages().get(0).bytes());
        assertFalse(restored.withoutArticle().hasArticle());
    }

    @Test public void rejectsVkBrowserUpgradeDnsClubAccessCaptchaAndTimeout() throws Exception {
        var vk = reader(fixture("vk-browser-upgrade.html"), new ArrayList<>());
        assertTrue(assertThrows(NotebookPreviewNetwork.Unavailable.class,
                () -> vk.get("https://vk.ru/wall-1_2", true, true)).restricted);
        for (int status : List.of(401, 403)) {
            var dns = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
                assertEquals("club.dns-shop.ru", url.host());
                NotebookPreviewNetwork.requirePublicStatus(status);
                return html(url, fixture("ordered-article.html"));
            });
            assertTrue(assertThrows(NotebookPreviewNetwork.Unavailable.class,
                    () -> dns.get("https://club.dns-shop.ru/blog/story", true, true)).restricted);
        }
        var captcha = reader("<h1>Checking your browser</h1><div id=captcha></div>", new ArrayList<>());
        assertTrue(assertThrows(NotebookPreviewNetwork.Unavailable.class,
                () -> captcha.get("https://example.org/story", true, true)).restricted);
        var timeout = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> { throw new SocketTimeoutException(); });
        assertThrows(SocketTimeoutException.class, () -> timeout.get("https://example.org/story", true, true));
        var missing = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            if (url.encodedPath().endsWith(".jpg")) throw new SocketTimeoutException();
            return html(url, fixture("ordered-article.html"));
        }).get("https://example.org/story", true, true);
        assertEquals("Reading the ridge", missing.title());
        assertNull(missing.article());
    }

    private static NotebookLinkPreview reader(String page, List<String> calls) {
        return new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            calls.add(url.encodedPath());
            return types.contains("text/html") ? html(url, page) : new NotebookPreviewNetwork.Body(JPEG, url, "image/jpeg", "image/jpeg");
        });
    }

    private static NotebookPreviewNetwork.Body html(HttpUrl url, String page) {
        return new NotebookPreviewNetwork.Body(page.getBytes(StandardCharsets.UTF_8), url, "text/html", "text/html; charset=utf-8");
    }

    private static String fixture(String name) throws IOException {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path file = dir.resolve("src/lib/fixtures/saved-links").resolve(name);
            if (Files.isRegularFile(file)) return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
        }
        throw new IOException("Shared article fixture missing");
    }
}
