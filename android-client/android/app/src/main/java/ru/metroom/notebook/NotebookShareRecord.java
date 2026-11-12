package ru.metroom.notebook;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class NotebookShareRecord {
    enum Kind { TEXT, LINK, FILES, MIXED }
    enum Status { DRAFT, QUEUED, RETRY, AUTH, ACCESS, CONFLICT, TOO_LARGE, ERROR, SENT }

    static final class Attachment {
        final String name;
        final String mime;
        final long size;
        Attachment(String name, String mime, long size) {
            this.name = name;
            this.mime = mime;
            this.size = size;
        }
    }

    final UUID id;
    final long receivedAt;
    final Kind kind;
    final String text;
    final String url;
    final List<Attachment> files;
    String title;
    String comment = "";
    List<String> tags = new ArrayList<>();
    String server = "";
    String accountId = "";
    String accountName = "";
    Status status = Status.DRAFT;
    int attempts;
    long retryAt;
    String remoteId = "";

    NotebookShareRecord(UUID id, long receivedAt, Kind kind, String title, String text, String url, List<Attachment> files) {
        this.id = id;
        this.receivedAt = receivedAt;
        this.kind = kind;
        this.title = title;
        this.text = text;
        this.url = url;
        this.files = files;
    }

    String key() { return id.toString(); }

    String payloadText() {
        if (comment.isEmpty()) return text;
        return text.isEmpty() ? comment : text + "\n\n" + comment;
    }

    String label() {
        if (!title.trim().isEmpty()) return title;
        if (!url.isEmpty()) return url;
        if (!files.isEmpty()) return files.get(0).name;
        return text.length() > 80 ? text.substring(0, 80) + "…" : text;
    }
}
