package ru.metroom.notebook;

import java.net.URI;
import java.net.URISyntaxException;

/** Only the bundled chooser may request an external, native-initiated navigation. */
final class NotebookLaunchPolicy {
    private NotebookLaunchPolicy() {}

    static boolean sameOrigin(String first, String second) {
        try {
            URI a = new URI(first);
            URI b = new URI(second);
            return a.getScheme() != null && a.getHost() != null && b.getScheme() != null && b.getHost() != null
                    && a.getScheme().equalsIgnoreCase(b.getScheme()) && a.getHost().equalsIgnoreCase(b.getHost())
                    && port(a) == port(b) && a.getRawUserInfo() == null && b.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException ignored) {
            return false;
        }
    }

    static boolean allows(String current, String local, String target) {
        if (!sameOrigin(current, local)) return false;
        try {
            URI uri = new URI(target);
            String path = uri.getPath();
            return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null && uri.getRawUserInfo() == null && uri.getRawFragment() == null
                    && path != null && path.endsWith("/app");
        } catch (URISyntaxException | NullPointerException ignored) {
            return false;
        }
    }

    private static int port(URI uri) {
        return uri.getPort() != -1 ? uri.getPort() : ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80);
    }
}
