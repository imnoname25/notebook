package ru.metroom.notebook;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import static org.junit.Assert.*;

public class NotebookShareHttpTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    @Test public void usesOneCookieOriginAndOperationKeyAndValidatesServerConfirmation() throws Exception {
        try (var wire = new MockWebServer()) {
            wire.start(InetAddress.getByName("127.0.0.1"), 0);
            var endpoint = NotebookShareServer.parse("http://127.0.0.1:" + wire.getPort());
            String session = "notebook_session=abcdefghijklmnopqrstuv";
            wire.enqueue(response(200, "application/json", "{\"authenticated\":true,\"user\":{\"id\":\"owner\",\"name\":\"Owner\"}}"));
            wire.enqueue(response(200, "text/html", "<html>login</html>"));
            wire.enqueue(response(302, "text/plain", "redirect").addHeader("Location", endpoint.base + "/untrusted-redirect"));
            wire.enqueue(response(201, "application/json", "{\"item\":{\"id\":\"result-1\",\"title\":\"A note\",\"text\":\"Text\",\"url\":null,\"reviewStatus\":\"pending\",\"attachments\":[{\"mimeType\":\"application/pdf\",\"size\":8}]}}"));

            var client = new NotebookShareHttp();
            var account = client.account(endpoint, session);
            assertNotNull(account);
            assertEquals("owner", account.id);
            var identity = wire.takeRequest();
            assertEquals("/api/auth/status", identity.getPath());
            assertEquals(session, identity.getHeader("Cookie"));
            var store = new NotebookShareStore(temp.newFolder(), new NotebookShareStoreTest.TestDisk());
            var item = store.capture(UUID.randomUUID(), 1, "A note", "Text", "", List.of(NotebookShareStoreTest.source(
                    "билеты.pdf", "%PDF-1.7".getBytes(StandardCharsets.US_ASCII))), endpoint, account);
            assertNull(client.upload(endpoint, session, store, item).remoteId);
            assertEquals(302, client.upload(endpoint, session, store, item).code);
            assertEquals("result-1", client.upload(endpoint, session, store, item).remoteId);
            assertEquals(4, wire.getRequestCount());
            for (int index = 0; index < 3; index++) {
                var request = wire.takeRequest();
                assertEquals("/api/saved-items", request.getPath());
                assertEquals(session, request.getHeader("Cookie"));
                assertEquals(endpoint.origin, request.getHeader("Origin"));
                assertEquals(item.key(), request.getHeader("Idempotency-Key"));
                String body = request.getBody().readUtf8();
                assertTrue(body.contains("name=\"payload\""));
                assertTrue(body.contains("filename=\"билеты.pdf\""));
                assertTrue(body.contains("%PDF-1.7"));
            }
        }
    }

    @Test public void ignoresUnrelatedCookiesAndRejectsAmbiguousSessionHeaders() {
        String session = "notebook_session=abcdefghijklmnopqrstuv";
        assertEquals(session, NotebookShareHttp.sessionCookie("theme=dark; " + session));
        assertNull(NotebookShareHttp.sessionCookie(session + "; " + session));
        assertNull(NotebookShareHttp.sessionCookie("notebook_session=malformed\r\n"));
        assertEquals(20_000, NotebookShareHttp.retryAfter("20"));
    }

    private static MockResponse response(int code, String type, String body) {
        return new MockResponse().setResponseCode(code).addHeader("Content-Type", type).setBody(body);
    }
}
