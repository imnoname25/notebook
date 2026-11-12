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
        client = new OkHttpClient.Builder()
                .cookieJar(CookieJar.NO_COOKIES)
                .proxy(Proxy.NO_PROXY)
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(false)
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .callTimeout(75, TimeUnit.SECONDS)
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
        Request request = request(server, "/api/saved-items", cookie)
                .header("Origin", server.origin)
                .header("Idempotency-Key", entry.key())
                .post(body).build();
        try (Response response = client.newCall(request).execute()) {
            int code = response.code();
            String id = code == 200 || code == 201 ? confirmedId(readJson(response.body(), 512 * 1024), entry) : null;
            return new NotebookShareSync.Result(code, id, code == 429 ? retryAfter(response.header("Retry-After")) : 0);
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
