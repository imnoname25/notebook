package ru.metroom.notebook;

import java.io.IOException;

final class NotebookShareSync {
    static final int MAX_ATTEMPTS = 6;
    private static final long MAX_BACKOFF = 5 * 60_000L;

    static final class Account {
        final NotebookShareServer server;
        final String id;
        final String name;

        Account(NotebookShareServer server, String id, String name) {
            this.server = server;
            this.id = id;
            this.name = name;
        }

        boolean owns(NotebookShareRecord entry) {
            return server.base.equals(entry.server) && id.equals(entry.accountId);
        }
    }

    static final class Result {
        final int code;
        final String remoteId;
        final long retryAfter;

        Result(int code, String remoteId, long retryAfter) {
            this.code = code;
            this.remoteId = remoteId;
            this.retryAfter = retryAfter;
        }
    }

    interface Sender { Result send(NotebookShareRecord entry) throws IOException; }

    static boolean due(NotebookShareRecord entry, Account account, long now) {
        return account != null && account.owns(entry) && entry.retryAt <= now
                && (entry.status == NotebookShareRecord.Status.QUEUED || entry.status == NotebookShareRecord.Status.RETRY
                || entry.status == NotebookShareRecord.Status.AUTH);
    }

    static void bind(NotebookShareRecord entry, Account account) {
        if (!entry.accountId.isEmpty() && !account.owns(entry)) throw new IllegalStateException("Share is assigned to another recipient");
        entry.server = account.server.base;
        entry.accountId = account.id;
        entry.accountName = account.name;
    }

    static boolean submit(NotebookShareStore store, NotebookShareRecord entry, Account account, long now, Sender sender) throws IOException {
        if (!due(entry, account, now)) return false;
        Result result;
        try {
            result = sender.send(entry);
        } catch (IOException unavailable) {
            result = new Result(0, null, 0);
        }
        apply(entry, result, System.currentTimeMillis());
        store.update(entry);
        if (entry.status != NotebookShareRecord.Status.SENT) return false;
        try {
            store.remove(entry.id);
        } catch (IOException ignored) {
            // The persisted receipt prevents another send. Recovery retries cleanup.
        }
        return true;
    }

    static void apply(NotebookShareRecord entry, Result result, long now) {
        entry.retryAt = 0;
        if ((result.code == 200 || result.code == 201) && result.remoteId != null && result.remoteId.matches("[A-Za-z0-9_-]{1,128}")) {
            entry.status = NotebookShareRecord.Status.SENT;
            entry.remoteId = result.remoteId;
        } else if (result.code == 401) {
            entry.status = NotebookShareRecord.Status.AUTH;
            entry.retryAt = now + 15_000;
        } else if (result.code == 403) {
            entry.status = NotebookShareRecord.Status.ACCESS;
        } else if (result.code == 409) {
            entry.status = NotebookShareRecord.Status.CONFLICT;
        } else if (result.code == 413) {
            entry.status = NotebookShareRecord.Status.TOO_LARGE;
        } else if (result.code == 0 || result.code == 200 || result.code == 201 || result.code == 408 || result.code == 429 || result.code >= 500) {
            entry.attempts++;
            entry.status = entry.attempts >= MAX_ATTEMPTS ? NotebookShareRecord.Status.ERROR : NotebookShareRecord.Status.RETRY;
            long delay = Math.min(MAX_BACKOFF, Math.max(2_000L << Math.min(10, entry.attempts - 1), result.retryAfter));
            entry.retryAt = now + delay;
        } else {
            entry.status = NotebookShareRecord.Status.ERROR;
        }
    }
}
