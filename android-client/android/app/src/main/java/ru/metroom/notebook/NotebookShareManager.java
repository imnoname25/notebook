package ru.metroom.notebook;

import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayDeque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class NotebookShareManager {
    interface Listener {
        void received(UUID id);
        void changed();
        void message(String text);
    }

    private static final long WAIT_FOR_ACCOUNT = 15_000;
    private static final long IDLE = Long.MAX_VALUE;
    private static NotebookShareManager instance;

    static synchronized NotebookShareManager get(Context context) {
        if (instance == null) instance = new NotebookShareManager((Application) context.getApplicationContext());
        return instance;
    }

    private final Application context;
    private final NotebookShareStore store;
    private final NotebookShareHttp http = new NotebookShareHttp();
    private final SharedPreferences settings;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService disk = Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ScheduledExecutorService sync = Executors.newSingleThreadScheduledExecutor();
    private final ArrayDeque<UUID> recent = new ArrayDeque<>();
    private final ConnectivityManager connectivity;
    private Listener listener;
    private boolean networkRegistered;
    private volatile NotebookShareServer selected;
    private volatile Verified verified;
    private volatile UUID sending;
    private volatile boolean foreground;
    private volatile NotebookShareServer unavailable;
    private ScheduledFuture<?> scheduled;
    private boolean running;
    private boolean refreshRequested;

    private static final class Verified {
        final NotebookShareSync.Account account;
        final byte[] proof;
        Verified(NotebookShareSync.Account account, String cookie) {
            this.account = account;
            this.proof = fingerprint(cookie);
        }
    }

    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { requestSync(); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) requestSync();
        }
    };

    private NotebookShareManager(Application context) {
        this.context = context;
        settings = context.getSharedPreferences("notebook-share", Context.MODE_PRIVATE);
        selected = NotebookShareServer.parse(settings.getString("server", ""));
        store = new NotebookShareStore(new File(context.getNoBackupFilesDir(), "saved-share-queue"), new NotebookShareDisk());
        connectivity = context.getSystemService(ConnectivityManager.class);
        disk.execute(() -> {
            try { store.recover(); }
            catch (IOException failure) { message("Не удалось полностью восстановить локальную очередь."); }
        });
    }

    void selectServer(NotebookShareServer server) {
        if (server != null && server.equals(selected)) { requestSync(); return; }
        selected = server;
        verified = null;
        unavailable = null;
        http.cancel();
        settings.edit().putString("server", server == null ? "" : server.base).apply();
        changed();
        requestSync();
    }

    boolean allowsQueue(String currentPage, String local) {
        var server = selected;
        return NotebookLaunchPolicy.sameOrigin(currentPage, local) || (server != null && server.ownsPage(currentPage));
    }

    void resume(Listener value) {
        listener = value;
        foreground = true;
        if (!networkRegistered && connectivity != null) {
            try {
                connectivity.registerDefaultNetworkCallback(networkCallback);
                networkRegistered = true;
            } catch (RuntimeException ignored) {
                // Startup, retry and resume still work without the callback.
            }
        }
        while (!recent.isEmpty()) value.received(recent.removeFirst());
        value.changed();
        requestSync();
    }

    synchronized void pause(Listener value) {
        if (listener != value) return;
        listener = null;
        foreground = false;
        refreshRequested = false;
        if (scheduled != null) scheduled.cancel(false);
        scheduled = null;
        if (networkRegistered) {
            try { connectivity.unregisterNetworkCallback(networkCallback); }
            catch (RuntimeException ignored) { /* Already unregistered. */ }
            networkRegistered = false;
        }
        http.cancel();
    }

    NotebookShareSync.Account currentAccount() {
        var current = verified;
        var server = selected;
        if (current == null || !current.account.server.equals(server)) return null;
        String cookie = cookie(server);
        return cookie != null && MessageDigest.isEqual(current.proof, fingerprint(cookie)) ? current.account : null;
    }

    boolean isSending(UUID id) { return id.equals(sending); }

    boolean waitingForNetwork(NotebookShareRecord entry) {
        var server = unavailable;
        return server != null && server.base.equals(entry.server) && !entry.accountId.isEmpty() && cookie(server) != null;
    }

    void receive(Intent intent) {
        long receivedAt = System.currentTimeMillis();
        var server = selected;
        var account = currentAccount();
        UUID id = UUID.randomUUID();
        disk.execute(() -> {
            try {
                var payload = NotebookShareIntent.parse(intent, context.getPackageName());
                store.capture(id, receivedAt, "", payload.text, payload.url, payload.sources(context), server, account,
                        payload.subject, payload.extraTitle);
                main.post(() -> {
                    if (listener == null) recent.addLast(id);
                    else {
                        listener.message("Сохранено на устройстве");
                        listener.received(id);
                        listener.changed();
                    }
                });
            } catch (IllegalArgumentException | SecurityException rejected) {
                // External providers can put private material in exception messages.
                message("Не удалось принять материал. Проверьте формат, доступ и размер (до 4 файлов по 10 МиБ).");
            } catch (IOException | RuntimeException failed) {
                message("Не удалось записать материал. Проверьте свободное место и поделитесь снова.");
            }
        });
    }

    void list(Consumer<List<NotebookShareRecord>> callback) {
        disk.execute(() -> {
            try {
                var result = store.list();
                main.post(() -> callback.accept(result));
            } catch (IOException failure) {
                message("Не удалось прочитать локальную очередь.");
            }
        });
    }

    void confirm(UUID id, String title, boolean titleEdited, String comment, List<String> tags, NotebookShareSync.Account recipient, Consumer<Boolean> finished) {
        disk.execute(() -> {
            boolean saved = false;
            try {
                var entry = store.read(id);
                if (entry == null || entry.status != NotebookShareRecord.Status.DRAFT) return;
                if (entry.sharedSubject == null || titleEdited) entry.title = title;
                entry.titleEdited |= titleEdited;
                entry.comment = comment;
                entry.tags = tags;
                if (entry.accountId.isEmpty() && recipient != null && stillVerified(recipient)) NotebookShareSync.bind(entry, recipient);
                entry.status = NotebookShareRecord.Status.QUEUED;
                store.update(entry);
                saved = true;
                message(entry.accountId.isEmpty() ? "Сохранено на устройстве. Выберите получателя после входа." : "Ожидает отправки");
                changed();
                requestSync();
            } catch (IOException failure) {
                message("Не удалось сохранить правки. Исходный материал остался в черновиках.");
            } finally {
                boolean result = saved;
                main.post(() -> finished.accept(result));
            }
        });
    }

    void assign(UUID id, NotebookShareSync.Account recipient) {
        sync.execute(() -> {
            try {
                var entry = store.read(id);
                if (entry == null || entry.status == NotebookShareRecord.Status.DRAFT || !entry.accountId.isEmpty()) return;
                if (!stillVerified(recipient)) { message("Сессия изменилась. Войдите и выберите получателя снова."); requestSync(); return; }
                NotebookShareSync.bind(entry, recipient);
                store.update(entry);
                changed();
                requestSync();
            } catch (IOException failure) { message("Не удалось сохранить получателя."); }
        });
    }

    void retry(UUID id) {
        sync.execute(() -> {
            try {
                var entry = store.read(id);
                if (entry == null || entry.status == NotebookShareRecord.Status.DRAFT || entry.status == NotebookShareRecord.Status.CONFLICT
                        || entry.status == NotebookShareRecord.Status.SENT) return;
                entry.attempts = 0;
                entry.retryAt = 0;
                entry.status = NotebookShareRecord.Status.QUEUED;
                store.update(entry);
                changed();
                requestSync();
            } catch (IOException failure) { message("Не удалось повторить отправку."); }
        });
    }

    void remove(UUID id) {
        sync.execute(() -> {
            try { store.remove(id); changed(); }
            catch (IOException failure) { message("Не удалось удалить локальный материал."); }
        });
    }

    synchronized void requestSync() { schedule(0); }

    private synchronized void schedule(long delay) {
        if (!foreground || delay == IDLE) return;
        if (running) {
            if (delay == 0) refreshRequested = true;
            return;
        }
        if (scheduled != null && scheduled.getDelay(TimeUnit.MILLISECONDS) <= delay) return;
        if (scheduled != null) scheduled.cancel(false);
        scheduled = sync.schedule(this::tick, delay, TimeUnit.MILLISECONDS);
    }

    private void tick() {
        synchronized (this) {
            scheduled = null;
            if (!foreground) return;
            running = true;
        }
        long next = IDLE;
        try {
            next = cycle();
        } catch (IOException | RuntimeException failure) {
            next = WAIT_FOR_ACCOUNT;
        } finally {
            synchronized (this) {
                running = false;
                if (refreshRequested) next = 0;
                refreshRequested = false;
                schedule(next);
            }
        }
    }

    private long cycle() throws IOException {
        var server = selected;
        if (server == null) return IDLE;
        List<NotebookShareRecord> entries = store.list();
        String cookie = cookie(server);
        if (cookie == null) {
            verified = null;
            unavailable = null;
            changed();
            return hasWaiting(entries) ? WAIT_FOR_ACCOUNT : IDLE;
        }
        NotebookShareSync.Account account;
        try {
            account = http.account(server, cookie);
        } catch (IOException offline) {
            if (server.equals(selected)) {
                unavailable = server;
                changed();
            }
            return hasWaiting(entries) ? WAIT_FOR_ACCOUNT : IDLE;
        }
        if (!foreground || !server.equals(selected) || !cookie.equals(cookie(server))) return IDLE;
        unavailable = null;
        verified = account == null ? null : new Verified(account, cookie);
        changed();
        if (account == null) return hasWaiting(entries) ? WAIT_FOR_ACCOUNT : IDLE;

        long now = System.currentTimeMillis();
        long next = IDLE;
        for (var entry : entries) {
            if (NotebookShareSync.due(entry, account, now)) {
                if (!foreground || !server.equals(selected) || !cookie.equals(cookie(server))) return IDLE;
                sending = entry.id;
                changed();
                try {
                    if (NotebookShareSync.submit(store, entry, account, now, item -> http.upload(server, cookie, store, item))) {
                        message("Сохранено в Блокнот");
                    }
                } finally {
                    sending = null;
                    changed();
                }
                return 0;
            }
            if (account.owns(entry) && (entry.status == NotebookShareRecord.Status.RETRY || entry.status == NotebookShareRecord.Status.AUTH)) {
                next = Math.min(next, Math.max(0, entry.retryAt - now));
            }
        }
        return next;
    }

    private static boolean hasWaiting(List<NotebookShareRecord> entries) {
        return entries.stream().anyMatch(entry -> entry.status == NotebookShareRecord.Status.QUEUED
                || entry.status == NotebookShareRecord.Status.RETRY || entry.status == NotebookShareRecord.Status.AUTH);
    }

    private boolean stillVerified(NotebookShareSync.Account recipient) {
        var current = currentAccount();
        return current != null && current.server.equals(recipient.server) && current.id.equals(recipient.id);
    }

    private static String cookie(NotebookShareServer server) {
        var manager = CookieManager.getInstance();
        String capture = NotebookShareHttp.sessionCookie(manager.getCookie(server.base + "/api/saved-items"));
        String status = NotebookShareHttp.sessionCookie(manager.getCookie(server.base + "/api/auth/status"));
        return capture != null && capture.equals(status) ? capture : null;
    }

    private static byte[] fingerprint(String cookie) {
        try { return MessageDigest.getInstance("SHA-256").digest(cookie.getBytes(StandardCharsets.UTF_8)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private void changed() { main.post(() -> { if (listener != null) listener.changed(); }); }
    private void message(String text) { main.post(() -> { if (listener != null) listener.message(text); }); }
}
