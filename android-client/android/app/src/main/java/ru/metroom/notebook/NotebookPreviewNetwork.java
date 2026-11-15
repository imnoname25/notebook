package ru.metroom.notebook;

import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Public source requests use the OS network and a client without Notebook credentials. */
final class NotebookPreviewNetwork {
    // The OS resolver may ignore interruption. Limit concurrent lookups and bound the wait.
    private static final ThreadPoolExecutor RESOLVER = new ThreadPoolExecutor(
            2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(4));
    private final OkHttpClient client = new OkHttpClient.Builder()
            .cookieJar(CookieJar.NO_COOKIES)
            .proxy(Proxy.NO_PROXY)
            .followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .connectTimeout(4, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
            .callTimeout(7, TimeUnit.SECONDS).build();
    private volatile boolean cancelled;
    private volatile Call activeCall;

    static class Unavailable extends IOException {
        final boolean retryable;
        final boolean restricted;
        Unavailable(boolean retryable) { this(retryable, false); }
        Unavailable(boolean retryable, boolean restricted) {
            super("Public preview unavailable");
            this.retryable = retryable;
            this.restricted = restricted;
        }
    }

    record Body(byte[] bytes, HttpUrl url, String type, String contentType) {}

    void cancel() {
        cancelled = true;
        Call current = activeCall;
        if (current != null) current.cancel();
    }

    Body read(HttpUrl start, int limit, List<String> types, boolean redirects, long deadline) throws IOException {
        HttpUrl url = start;
        for (int hop = 0; hop <= 3; hop++) {
            if (url == null) throw new Unavailable(false);
            if (NotebookLinkPreview.isGateUrl(url)) throw new Unavailable(false, true);
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0 || cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
            HttpUrl target = url;
            List<InetAddress> addresses = resolveHost(target.host(), remaining);
            remaining = deadline - System.nanoTime();
            if (remaining <= 0 || cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
            var pinned = client.newBuilder().dns(host -> {
                if (!host.equals(target.host())) throw new UnknownHostException("Unexpected source host");
                return addresses;
            }).build();
            var call = pinned.newCall(new Request.Builder().url(target)
                    .header("Accept", String.join(", ", types))
                    .header("User-Agent", "Notebook-Android-Preview/1").build());
            call.timeout().timeout(Math.min(remaining, TimeUnit.SECONDS.toNanos(7)), TimeUnit.NANOSECONDS);
            activeCall = call;
            if (cancelled) call.cancel();
            try (var response = call.execute()) {
                int code = response.code();
                if ("challenge".equalsIgnoreCase(response.header("cf-mitigated"))) throw new Unavailable(false, true);
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = response.header("Location");
                    if (!redirects || hop == 3 || location == null) throw new Unavailable(false);
                    HttpUrl next = resolve(location, url);
                    if (next == null || (url.isHttps() && !next.isHttps())) throw new Unavailable(false);
                    url = next;
                    continue;
                }
                requirePublicStatus(code);
                var body = response.body();
                var mime = body == null ? null : body.contentType();
                String type = mime == null ? "" : mime.type() + "/" + mime.subtype();
                if (!types.contains(type) || body == null || body.contentLength() > limit) throw new Unavailable(false);
                var source = body.source();
                if (source.request(limit + 1L)) throw new Unavailable(false);
                return new Body(source.readByteArray(), url, type, mime.toString());
            } finally {
                activeCall = null;
            }
        }
        throw new Unavailable(false);
    }

    static void requirePublicStatus(int code) throws Unavailable {
        if (code == 401 || code == 403 || code == 451 || code == 511) throw new Unavailable(false, true);
        if (code != 200) throw new Unavailable(code == 408 || code == 429 || code >= 500);
    }

    private static List<InetAddress> resolveHost(String host, long remaining) throws IOException {
        Future<List<InetAddress>> lookup;
        try { lookup = RESOLVER.submit(() -> Dns.SYSTEM.lookup(host)); }
        catch (RejectedExecutionException busy) { throw new java.net.SocketTimeoutException("Source DNS is busy"); }
        try {
            return publicAddresses(lookup.get(Math.min(TimeUnit.SECONDS.toNanos(3), remaining), TimeUnit.NANOSECONDS));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new InterruptedIOException();
        } catch (TimeoutException deadline) {
            throw new java.net.SocketTimeoutException("Public source DNS did not respond");
        } catch (ExecutionException failed) {
            throw new UnknownHostException("Could not resolve public source");
        } finally {
            lookup.cancel(true);
        }
    }

    static HttpUrl resolve(String value, HttpUrl base) {
        if (value == null || value.isBlank() || value.length() > 2048 || value.indexOf('\\') >= 0
                || value.chars().anyMatch(ch -> ch < 32 || ch == 127)) return null;
        HttpUrl url = base == null ? HttpUrl.parse(value) : base.resolve(value);
        if (url == null || !url.encodedUsername().isEmpty() || !url.encodedPassword().isEmpty()
                || url.port() != (url.isHttps() ? 443 : 80)) return null;
        String host = url.host().replaceFirst("\\.$", "");
        if (host.matches("(?i)(?:.*\\.)?(?:localhost|local|internal|home\\.arpa)")
                || (!host.contains(".") && !host.contains(":"))) return null;
        if (host.contains(":") || host.matches("[0-9.]+")) {
            try {
                // The strict numeric syntax avoids a platform DNS lookup here.
                if (!host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}") && !host.contains(":")) return null;
                if (!isPublic(InetAddress.getByName(host))) return null;
            } catch (UnknownHostException invalid) { return null; }
        }
        return url.newBuilder().fragment(null).build();
    }

    static List<InetAddress> publicAddresses(List<InetAddress> addresses) throws UnknownHostException {
        if (addresses.isEmpty() || addresses.stream().anyMatch(address -> !isPublic(address))) {
            throw new UnknownHostException("Source DNS did not return public addresses");
        }
        return addresses;
    }

    static boolean isPublic(InetAddress address) {
        byte[] b = address.getAddress();
        int a = b[0] & 255, second = b[1] & 255, third = b[2] & 255;
        if (b.length == 4) {
            return a > 0 && a < 224 && a != 10 && a != 127
                    && !(a == 100 && second >= 64 && second <= 127)
                    && !(a == 169 && second == 254)
                    && !(a == 172 && second >= 16 && second <= 31)
                    && !(a == 192 && (second == 168 || (second == 0 && (third == 0 || third == 2))
                            || (second == 88 && third == 99)))
                    && !(a == 198 && (second == 18 || second == 19 || (second == 51 && third == 100)))
                    && !(a == 203 && second == 0 && third == 113);
        }
        if ((a & 0xe0) != 0x20 || (a == 0x20 && second == 2) || (a == 0x3f && second == 0xff && third < 0x20)) return false;
        return !(a == 0x20 && second == 1 && (third < 2 || third == 0x0d && (b[3] & 255) == 0xb8));
    }
}
