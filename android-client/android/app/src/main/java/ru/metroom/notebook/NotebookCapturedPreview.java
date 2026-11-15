package ru.metroom.notebook;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.Set;

/** The immutable result retained with a share until Notebook acknowledges it. */
record NotebookCapturedPreview(JSONObject payload, byte[] cover, String mime) {
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
        if (data.title() == null && data.description() == null && data.siteName() == null && data.image() == null) {
            fields.put("failure", "extraction");
        }
        if (data.image() == null) fields.put("media", data.expectedCover() ? "unavailable" : "none");
        return new NotebookCapturedPreview(fields, data.image(), data.mime());
    }

    static NotebookCapturedPreview unavailable(String reason) {
        try { return new NotebookCapturedPreview(new JSONObject().put("version", 1).put("failure", reason), null, null); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    NotebookCapturedPreview withoutCover() throws JSONException {
        var text = new JSONObject(payload.toString()).put("media", "unavailable");
        var sources = text.optJSONObject("provenance");
        if (sources != null) sources.remove("cover");
        return new NotebookCapturedPreview(text, null, null);
    }

    JSONObject legacyFields() throws JSONException {
        var text = new JSONObject();
        for (String field : Set.of("title", "description", "siteName")) {
            if (payload.has(field)) text.put(field, payload.get(field));
        }
        return text;
    }

    void write(DataOutputStream out) throws IOException {
        out.writeUTF(payload.toString());
        out.writeUTF(mime == null ? "" : mime);
        out.writeInt(cover == null ? 0 : cover.length);
        if (cover != null) out.write(cover);
    }

    static NotebookCapturedPreview read(DataInputStream in) throws IOException {
        try {
            var fields = new JSONObject(in.readUTF());
            String mime = in.readUTF();
            int size = in.readInt();
            if (fields.optInt("version") != 1 || size < 0 || size > NotebookLinkPreview.MAX_COVER_BYTES) {
                throw new IOException("Invalid capture snapshot");
            }
            if (size == 0) return new NotebookCapturedPreview(fields, null, null);
            byte[] cover = new byte[size];
            in.readFully(cover);
            if (!mime.equals(NotebookShareInput.mime(cover, size))) throw new IOException("Invalid capture image");
            return new NotebookCapturedPreview(fields, cover, mime);
        } catch (JSONException invalid) {
            throw new IOException("Invalid capture snapshot", invalid);
        }
    }
}
