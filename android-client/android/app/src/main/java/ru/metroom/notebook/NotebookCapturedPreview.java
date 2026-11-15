package ru.metroom.notebook;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The immutable result retained with a share until Notebook acknowledges it. */
record NotebookCapturedPreview(JSONObject payload, byte[] cover, String mime, List<NotebookArticleCapture.Image> articleImages) {
    private static final int MAX_ARTICLE_PAYLOAD_BYTES = 1280 * 1024;

    static NotebookCapturedPreview success(NotebookLinkPreview.Result data) throws JSONException {
        var fields = new JSONObject()
                .put("title", data.title()).put("description", data.description()).put("siteName", data.siteName())
                .put("contentType", data.kind()).put("canonicalUrl", data.canonical()).put("author", data.author())
                .put("publishedAt", data.publishedAt()).put("videoId", data.videoId());
        var sources = new JSONObject();
        for (Map.Entry<String, String> source : data.provenance().entrySet()) {
            if (fields.has(source.getKey()) || ("cover".equals(source.getKey()) && data.image() != null)) {
                sources.put(source.getKey(), source.getValue());
            }
        }
        fields.put("provenance", sources).put("version", 1);
        if (data.title() == null && data.description() == null && data.siteName() == null && data.image() == null && data.article() == null) {
            fields.put("failure", "extraction");
        }
        if (data.image() == null) fields.put("media", data.expectedCover() ? "unavailable" : "none");
        if (data.article() != null) fields.put("article", data.article().payload());
        return new NotebookCapturedPreview(fields, data.image(), data.mime(), data.article() == null ? List.of() : data.article().images());
    }

    static NotebookCapturedPreview unavailable(String reason) {
        try { return new NotebookCapturedPreview(new JSONObject().put("version", 1).put("failure", reason), null, null, List.of()); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    NotebookCapturedPreview withoutCover() throws JSONException {
        var text = new JSONObject(payload.toString()).put("media", "unavailable");
        var sources = text.optJSONObject("provenance");
        if (sources != null) sources.remove("cover");
        return new NotebookCapturedPreview(text, null, null, articleImages);
    }

    boolean hasArticle() { return payload.has("article"); }

    NotebookCapturedPreview withoutArticle() throws JSONException {
        var metadata = new JSONObject(payload.toString());
        metadata.remove("article");
        return new NotebookCapturedPreview(metadata, cover, mime, List.of());
    }

    long storageBytes() {
        return payload.toString().getBytes(StandardCharsets.UTF_8).length + 1024L + (cover == null ? 0 : cover.length)
                + articleImages.stream().mapToLong(image -> image.bytes().length).sum();
    }

    JSONObject legacyFields() throws JSONException {
        var text = new JSONObject();
        for (String field : Set.of("title", "description", "siteName")) {
            if (payload.has(field)) text.put(field, payload.get(field));
        }
        return text;
    }

    void write(DataOutputStream out) throws IOException {
        if (hasArticle()) {
            byte[] json = payload.toString().getBytes(StandardCharsets.UTF_8);
            if (json.length > MAX_ARTICLE_PAYLOAD_BYTES || articleImages.size() > NotebookArticleCapture.MAX_IMAGES)
                throw new IOException("Capture snapshot exceeds limits");
            out.writeUTF(""); // Reserved marker. Earlier snapshots start with a non-empty JSON object.
            out.writeInt(json.length);
            out.write(json);
        } else out.writeUTF(payload.toString());
        writeImage(out, mime, cover);
        if (!hasArticle()) return;
        out.writeByte(articleImages.size());
        for (var image : articleImages) {
            out.writeUTF(image.key());
            writeImage(out, image.mime(), image.bytes());
        }
    }

    static NotebookCapturedPreview read(DataInputStream in) throws IOException {
        try {
            String json = in.readUTF();
            boolean extended = json.isEmpty();
            if (extended) json = new String(readBytes(in, MAX_ARTICLE_PAYLOAD_BYTES), StandardCharsets.UTF_8);
            var fields = new JSONObject(json);
            if (fields.optInt("version") != 1 || fields.has("article") != extended) throw new IOException("Invalid capture snapshot");
            var cover = readImage(in, "", NotebookLinkPreview.MAX_COVER_BYTES);
            var images = new ArrayList<NotebookArticleCapture.Image>();
            if (extended) {
                int count = in.readUnsignedByte();
                int remaining = NotebookArticleCapture.MAX_IMAGES_BYTES;
                if (count > NotebookArticleCapture.MAX_IMAGES) throw new IOException("Invalid capture image count");
                for (int i = 0; i < count; i++) {
                    String key = in.readUTF();
                    var image = readImage(in, key, Math.min(remaining, NotebookArticleCapture.MAX_IMAGE_BYTES));
                    if (!key.matches("[a-f0-9]{64}") || image.bytes().length == 0) throw new IOException("Invalid article image");
                    images.add(image);
                    remaining -= image.bytes().length;
                }
            }
            return new NotebookCapturedPreview(fields, cover.bytes().length == 0 ? null : cover.bytes(), cover.mime(), List.copyOf(images));
        } catch (JSONException invalid) {
            throw new IOException("Invalid capture snapshot", invalid);
        }
    }

    private static void writeImage(DataOutputStream out, String mime, byte[] bytes) throws IOException {
        out.writeUTF(mime == null ? "" : mime);
        out.writeInt(bytes == null ? 0 : bytes.length);
        if (bytes != null) out.write(bytes);
    }

    private static NotebookArticleCapture.Image readImage(DataInputStream in, String key, int limit) throws IOException {
        String mime = in.readUTF();
        byte[] bytes = readBytes(in, limit);
        if (bytes.length != 0 && !mime.equals(NotebookShareInput.mime(bytes, bytes.length))) throw new IOException("Invalid capture image");
        return new NotebookArticleCapture.Image(key, mime, bytes);
    }

    private static byte[] readBytes(DataInputStream in, int limit) throws IOException {
        int size = in.readInt();
        if (size < 0 || size > limit) throw new IOException("Invalid capture size");
        byte[] bytes = new byte[size];
        in.readFully(bytes);
        return bytes;
    }
}
