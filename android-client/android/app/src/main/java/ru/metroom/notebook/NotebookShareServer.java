package ru.metroom.notebook;

import java.net.URI;
import java.util.Locale;
import java.util.Objects;

/** The base path is part of the receiver identity, even on a shared origin. */
final class NotebookShareServer {
    final String base;
    final String origin;
    private final String path;

    private NotebookShareServer(String origin, String path) {
        this.origin = origin;
        this.path = path;
        this.base = origin + path;
    }

    static NotebookShareServer fromLaunch(String launch) {
        try {
            URI url = URI.create(launch);
            String path = url.getRawPath();
            if (path == null || !path.endsWith("/app") || url.getRawFragment() != null) return null;
            return parse(origin(url) + path.substring(0, path.length() - 4));
        } catch (IllegalArgumentException | NullPointerException ignored) {
            return null;
        }
    }

    static NotebookShareServer parse(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            URI uri = URI.create(value);
            String path = uri.getRawPath();
            if (uri.getRawQuery() != null || uri.getRawFragment() != null || path == null
                    || !path.equals(uri.normalize().getRawPath()) || path.endsWith("/")
                    || path.toLowerCase(Locale.ROOT).matches(".*%(?:2e|2f|5c).*")) return null;
            return new NotebookShareServer(origin(uri), path);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static String origin(URI uri) {
        if (uri.getHost() == null || uri.getScheme() == null || uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("Invalid server address");
        }
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) throw new IllegalArgumentException("Invalid server scheme");
        int port = uri.getPort();
        if (port == 0 || port > 65535) throw new IllegalArgumentException("Invalid server port");
        boolean standard = port == -1 || port == (scheme.equals("https") ? 443 : 80);
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + (standard ? "" : ":" + port);
    }

    boolean ownsPage(String url) {
        if (!NotebookLaunchPolicy.sameOrigin(base, url)) return false;
        String requested = URI.create(url).getRawPath();
        return path.isEmpty() || requested.equals(path) || requested.startsWith(path + "/");
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof NotebookShareServer && base.equals(((NotebookShareServer) other).base);
    }

    @Override
    public int hashCode() { return Objects.hash(base); }
}
