package ru.metroom.notebook;

import okhttp3.CookieJar;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.net.Proxy;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

final class NotebookShareHttp {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private final OkHttpClient client;

    NotebookShareHttp() {
        this(75);
    }

    NotebookShareHttp(int callTimeout) {
        client = new OkHttpClient.Builder()
                .cookieJar(CookieJar.NO_COOKIES)
                .proxy(Proxy.NO_PROXY)
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(false)
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .callTimeout(callTimeout, TimeUnit.SECONDS)
                .build();
    }

    void cancel() { client.dispatcher().cancelAll(); }

    NotebookShareSync.Account account(NotebookShareServer server, String cookie) throws IOException {
        Request request = request(server, "/api/auth/status", cookie).get().build();
        try (Response response = client.newCall(request).execute()) {
            if (response.code() == 401 || response.code() == 403) return null;
            if (!response.isSuccessful()) throw new IOException("Could not verify Notebook session");
            JSONObject document = readJson(response.body(), 64 * 1024);
            if (document == null || !Boolean.TRUE.equals(document.opt("authenticated"))) return null;
            JSONObject user = document.optJSONObject("user");
            if (user == null || Boolean.TRUE.equals(user.opt("mustChangePassword"))) return null;
            Object id = user.opt("id");
            if (!(id instanceof String) || !((String) id).matches("[A-Za-z0-9_-]{1,128}")) return null;
            String name = NotebookShareInput.title(user.optString("name", ""));
            if (name.isEmpty()) name = NotebookShareInput.title(user.optString("email", ""));
            return new NotebookShareSync.Account(server, (String) id, name.isEmpty() ? (String) id : name);
        }
    }

    NotebookShareSync.Result upload(NotebookShareServer server, String cookie, NotebookShareStore store, NotebookShareRecord entry) throws IOException {
        JSONObject payload = new JSONObject();
        try {
            payload.put("title", entry.title);
            if (!entry.sharedTitle().isEmpty()) payload.put("sharedTitle", entry.sharedTitle());
            payload.put("text", entry.payloadText());
            payload.put("url", entry.url.isEmpty() ? JSONObject.NULL : entry.url);
            payload.put("tags", new JSONArray(entry.tags));
        } catch (JSONException invalid) {
            return new NotebookShareSync.Result(400, null, 0);
        }
        RequestBody body = RequestBody.create(payload.toString(), JSON);
        if (!entry.files.isEmpty()) {
            var multipart = new MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("payload", payload.toString());
            for (int index = 0; index < entry.files.size(); index++) {
                var attachment = entry.files.get(index);
                File file;
                try {
                    file = store.attachment(entry, index);
                } catch (IOException incomplete) {
                    return new NotebookShareSync.Result(400, null, 0);
                }
                multipart.addFormDataPart("file", attachment.name, RequestBody.create(file, MediaType.get(attachment.mime)));
            }
            body = multipart.build();
        }
        Request.Builder outgoing = request(server, "/api/saved-items", cookie)
                .header("Origin", server.origin)
                .header("Idempotency-Key", entry.key())
                .post(body);
        if (entry.androidFirst) outgoing.header("X-Notebook-Device-Capture", "1");
        try (Response response = client.newCall(outgoing.build()).execute()) {
            int code = response.code();
            String id = code == 200 || code == 201 ? confirmedId(readJson(response.body(), 512 * 1024), entry) : null;
            return new NotebookShareSync.Result(code, id, code == 429 ? retryAfter(response.header("Retry-After")) : 0);
        }
    }

    String previewSource(NotebookShareServer server, String cookie, String id) throws IOException {
        Request request = request(server, "/api/saved-items/" + id, cookie).get().build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new NotebookPreviewNetwork.Unavailable(response.code() >= 500 || response.code() == 429 || response.code() == 408);
            }
            JSONObject document = readJson(response.body(), 512 * 1024);
            JSONObject item = document == null ? null : document.optJSONObject("item");
            if (item == null || !id.equals(item.opt("id")) || !Boolean.TRUE.equals(item.opt("supportsDevicePreview"))) return null;
            Object url = item.opt("url");
            return url instanceof String ? (String) url : null;
        }
    }

    int uploadPreview(NotebookShareServer server, String cookie, String id, String key, NotebookLinkPreview.Result preview) throws IOException {
        JSONObject payload = new JSONObject();
        try {
            payload.put("title", preview.title()).put("description", preview.description()).put("siteName", preview.siteName());
        } catch (JSONException invalid) {
            throw new IOException("Invalid device preview");
        }
        return uploadPreview(server, cookie, id, key, "device-preview", payload, preview.image(), preview.mime(), java.util.List.of());
    }

    int uploadCapture(NotebookShareServer server, String cookie, NotebookShareRecord entry,
                      NotebookCapturedPreview preview, boolean legacy) throws IOException, JSONException {
        JSONObject payload = legacy ? preview.legacyFields() : preview.payload();
        if (legacy && payload.length() == 0 && preview.cover() == null) return 204;
        return uploadPreview(server, cookie, entry.remoteId, entry.key(), legacy ? "device-preview" : "device-capture",
                payload, preview.cover(), preview.mime(), legacy ? java.util.List.of() : preview.articleImages());
    }

    private int uploadPreview(NotebookShareServer server, String cookie, String id, String key, String route,
                              JSONObject payload, byte[] cover, String mime, java.util.List<NotebookArticleCapture.Image> images) throws IOException {
        RequestBody body = RequestBody.create(payload.toString(), JSON);
        if (cover != null || !images.isEmpty()) {
            var form = new MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("payload", payload.toString());
            if (cover != null) form.addFormDataPart("cover", "preview", RequestBody.create(cover, MediaType.get(mime)));
            for (var image : images) form.addFormDataPart("image." + image.key(), "article-image",
                    RequestBody.create(image.bytes(), MediaType.get(image.mime())));
            body = form.build();
        }
        Request request = request(server, "/api/saved-items/" + id + "/" + route, cookie)
                .header("Origin", server.origin).header("Idempotency-Key", key).put(body).build();
        try (Response response = client.newCall(request).execute()) {
            return response.code();
        }
    }

    private static Request.Builder request(NotebookShareServer server, String path, String cookie) {
        return new Request.Builder().url(server.base + path)
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
                .header("Cookie", cookie);
    }

    static String sessionCookie(String raw) {
        if (raw == null) return null;
        String value = null;
        for (String part : raw.split(";")) {
            String cookie = part.trim();
            if (!cookie.startsWith("notebook_session=")) continue;
            if (value != null || !cookie.matches("notebook_session=[A-Za-z0-9_-]{16,128}")) return null;
            value = cookie;
        }
        return value;
    }

    private static JSONObject readJson(ResponseBody body, long limit) throws IOException {
        if (body == null || body.contentType() == null || !body.contentType().type().equals("application")
                || !body.contentType().subtype().equals("json") || body.contentLength() > limit) return null;
        var source = body.source();
        if (source.request(limit + 1)) return null;
        try {
            return new JSONObject(source.readUtf8());
        } catch (JSONException invalid) {
            return null;
        }
    }

    static String confirmedId(JSONObject document, NotebookShareRecord entry) {
        JSONObject item = document == null ? null : document.optJSONObject("item");
        if (item == null || !(item.opt("id") instanceof String) || !(item.opt("title") instanceof String)
                || !entry.payloadText().equals(item.opt("text"))
                || !(entry.url.isEmpty() ? item.has("url") && item.isNull("url") : entry.url.equals(item.opt("url")))) return null;
        String id = item.optString("id", "");
        String review = item.optString("reviewStatus", "");
        JSONArray attachments = item.optJSONArray("attachments");
        if (!id.matches("[A-Za-z0-9_-]{1,128}") || (!review.equals("pending") && !review.equals("reviewed"))
                || attachments == null || attachments.length() != entry.files.size()) return null;
        for (int index = 0; index < attachments.length(); index++) {
            JSONObject received = attachments.optJSONObject(index);
            var expected = entry.files.get(index);
            if (received == null || !expected.mime.equals(received.opt("mimeType")) || !(received.opt("size") instanceof Number)
                    || received.optLong("size", -1) != expected.size) return null;
        }
        return id;
    }

    static long retryAfter(String value) {
        if (value == null) return 0;
        try {
            return Math.min(300, Math.max(0, Long.parseLong(value.trim()))) * 1000;
        } catch (NumberFormatException ignored) {
            var format = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
            try {
                var date = format.parse(value);
                return date == null ? 0 : Math.min(300_000, Math.max(0, date.getTime() - System.currentTimeMillis()));
            } catch (ParseException invalid) {
                return 0;
            }
        }
    }
}
