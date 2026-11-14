package ru.metroom.notebook;

import okhttp3.HttpUrl;
import org.junit.Test;

import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;

public class NotebookLinkPreviewTest {
    private static final String WATCH = "https://www.youtube.com/watch?v=testVideo_1";
    private static final String COVER = "https://i.ytimg.com/vi/testVideo_1/hqdefault.jpg";
    private static final String OEMBED = "{\"type\":\"video\",\"title\":\"Night trail\",\"author_name\":\"Field notes\","
            + "\"thumbnail_url\":\"" + COVER + "\",\"html\":\"<iframe>ignored</iframe>\"}";

    @Test public void readsYoutubeCoverBytesAndUsesOnlyCanonicalIdForProvider() throws Exception {
        var calls = new ArrayList<HttpUrl>();
        byte[] jpeg = {(byte) 255, (byte) 216, (byte) 255, 1};
        var reader = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            calls.add(url);
            assertFalse(redirects);
            return calls.size() == 1 ? body(url, OEMBED, "application/json")
                    : new NotebookPreviewNetwork.Body(jpeg, url, "image/jpeg", "image/jpeg");
        });
        var result = reader.get("https://youtu.be/testVideo_1?si=private-token");
        assertEquals("video", result.kind());
        assertEquals("Night trail", result.title());
        assertEquals("YouTube · Field notes", result.siteName());
        assertArrayEquals(jpeg, result.image());
        assertEquals("www.youtube.com", calls.get(0).host());
        assertEquals("/oembed", calls.get(0).encodedPath());
        assertEquals(WATCH, calls.get(0).queryParameter("url"));
        assertEquals(COVER, calls.get(1).toString());
    }

    @Test public void usesNoembedJsonAfterNetworkFailureAndKeepsTextWhenCdnIsUnreachable() throws Exception {
        var hosts = new ArrayList<String>();
        var reader = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            hosts.add(url.host());
            if (!"noembed.com".equals(url.host())) throw new SocketTimeoutException();
            assertEquals(WATCH, url.queryParameter("url"));
            assertTrue(types.contains("text/javascript"));
            assertNull(url.queryParameter("callback"));
            return body(url, OEMBED, "text/javascript; charset=utf-8");
        });
        var result = reader.get(WATCH);
        assertEquals("Night trail", result.title());
        assertEquals("YouTube · Field notes", result.siteName());
        assertNull(result.image());
        assertEquals(List.of("www.youtube.com", "noembed.com", "i.ytimg.com"), hosts);
    }

    @Test public void stopsWhenTheOfficialProviderDeniesAccess() {
        var hosts = new ArrayList<String>();
        var reader = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            hosts.add(url.host());
            throw new NotebookPreviewNetwork.Unavailable(false, true);
        });
        assertThrows(NotebookPreviewNetwork.Unavailable.class, () -> reader.get(WATCH));
        assertEquals(List.of("www.youtube.com"), hosts);
    }

    @Test public void onlyUsesExplicitOpenGraphCoverAndSkipsPikabuSidebarLogin() throws Exception {
        String html = "<meta charset=windows-1251><meta property=og:title content='Запись &amp; маршрут'>"
                + "<meta name=twitter:description content='Описание'>"
                + "<meta property=og:image content='/account/profile.png'><meta property=og:image content='../story.webp'>"
                + "<aside><form><input type=password></form></aside>"
                + "<div class='app__auth auth'><form><input type=password></form></div>"
                + "<article><div class=community-avatar><img src=/account/profile.png></div><p>"
                + "Первый абзац открывает рассказ об осеннем маршруте и описывает путь от дома до старого моста.</p></article>";
        var calls = new ArrayList<HttpUrl>();
        var reader = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            calls.add(url);
            if (calls.size() == 2) return body(url, "<html>not a raster</html>", "image/webp");
            HttpUrl target = HttpUrl.get("https://pikabu.ru/story/entry/");
            return new NotebookPreviewNetwork.Body(html.getBytes(Charset.forName("windows-1251")), target, "text/html", "text/html");
        });
        var result = reader.get("https://pikabu.ru/story/entry?share=true");
        assertEquals("article", result.kind());
        assertEquals("Запись & маршрут", result.title());
        assertEquals("Описание", result.description());
        assertNull(result.image());
        assertEquals("https://pikabu.ru/story/story.webp", calls.get(1).toString());
        assertEquals(2, calls.size());
    }

    @Test public void rejectsBrowserUpgradeCaptchaAndUnavailableDnsClub() throws Exception {
        var blocked = List.of(
                "<title>ВКонтакте</title><meta property=og:title content='Incorrect'><h1>Ваш <span>браузер устарел</span></h1>",
                "<meta property=og:title content='Wrong'><div class=g-recaptcha></div>",
                "<meta property=og:title content='Incorrect'><form><input type=password></form>");
        for (String html : blocked) {
            var reader = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> body(url, html, "text/html"));
            assertThrows(NotebookPreviewNetwork.Unavailable.class, () -> reader.get("https://vk.ru/wall-1_2"));
        }
        var inaccessible = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            assertEquals("club.dns-shop.ru", url.host());
            throw new NotebookPreviewNetwork.Unavailable(false, true);
        });
        assertTrue(assertThrows(NotebookPreviewNetwork.Unavailable.class,
                () -> inaccessible.get("https://club.dns-shop.ru/blog/example")).restricted);
    }

    @Test public void parsesPublicThreadsAndIgnoresARejectedCoverAddress() throws Exception {
        var reader = new NotebookLinkPreview((url, limit, types, redirects, deadline) -> {
            assertEquals("threads.com", url.host());
            return body(url, "<meta name=twitter:title content='A post'><meta name=twitter:site content=Threads>"
                    + "<meta name=twitter:image content='http://127.0.0.1/cover.png'>", "text/html");
        });
        var result = reader.get("https://threads.com/@notes/post/Cabc123");
        assertEquals("social", result.kind());
        assertEquals("A post", result.title());
        assertEquals("Threads", result.siteName());
        assertNull(result.image());
    }

    @Test public void acceptsSupportedYoutubeFormsAndExcludesNonVideoUrls() {
        for (String value : List.of(WATCH, "https://youtu.be/testVideo_1", "https://m.youtube.com/watch?v=testVideo_1",
                "https://www.youtube.com/shorts/testVideo_1", "https://www.youtube-nocookie.com/embed/testVideo_1",
                "https://www.youtube.com/live/testVideo_1")) {
            assertEquals("testVideo_1", NotebookLinkPreview.youtubeId(HttpUrl.get(value)));
        }
        assertNull(NotebookLinkPreview.youtubeId(HttpUrl.get("https://www.youtube.com/playlist?list=example")));
        assertNull(NotebookLinkPreview.youtubeId(HttpUrl.get("https://example.org/watch?v=testVideo_1")));
    }

    @Test public void validatesPublicAddressesAndRefusesLocalUrlsBeforeNetworkAccess() throws Exception {
        for (String url : List.of("http://127.0.0.1/", "https://192.168.0.8/", "https://10.0.0.3/", "https://[::1]/",
                "https://router.local/", "https://example.org:8443/", "https://user:password@example.org/", "file:///data/item")) {
            assertNull(NotebookPreviewNetwork.resolve(url, null));
        }
        var external = InetAddress.getByAddress(new byte[]{8, 8, 8, 8});
        var loopback = InetAddress.getByAddress(new byte[]{127, 0, 0, 1});
        assertEquals(List.of(external), NotebookPreviewNetwork.publicAddresses(List.of(external)));
        assertThrows(UnknownHostException.class, () -> NotebookPreviewNetwork.publicAddresses(List.of(external, loopback)));
    }

    private static NotebookPreviewNetwork.Body body(HttpUrl url, String data, String type) {
        return new NotebookPreviewNetwork.Body(data.getBytes(StandardCharsets.UTF_8), url, type.split(";")[0], type);
    }
}
