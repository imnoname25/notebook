package ru.metroom.notebook;

import java.net.URI;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

final class NotebookShareInput {
    static final int MAX_TEXT = 50_000;
    static final int MAX_FILES = 4;
    static final long MAX_FILE_BYTES = 10L * 1024 * 1024;
    static final long MAX_TOTAL_BYTES = 31L * 1024 * 1024;
    private static final Pattern LINK = Pattern.compile("(?i)https?://[^\\s<>\\u0000\"']+");
    private static final Pattern TAG = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,63}");

    private NotebookShareInput() {}

    static String text(CharSequence value) {
        if (value == null) return "";
        String text = value.toString();
        if (text.length() > MAX_TEXT || text.indexOf(0) >= 0) throw new IllegalArgumentException("Текст слишком длинный или повреждён.");
        return text;
    }

    static String url(String text) {
        var matcher = LINK.matcher(text);
        while (matcher.find()) {
            String candidate = matcher.group();
            if (candidate.length() > 2048) continue;
            candidate = candidate.replaceFirst("[.,!?;:\\]}]+$", "");
            if (candidate.endsWith(")") && candidate.chars().filter(ch -> ch == ')').count()
                    > candidate.chars().filter(ch -> ch == '(').count()) {
                candidate = candidate.substring(0, candidate.length() - 1);
            }
            try {
                URI uri = URI.create(candidate);
                if (uri.getHost() != null && uri.getRawUserInfo() == null) return candidate;
            } catch (IllegalArgumentException ignored) {
                // Continue to the next URL in the shared text.
            }
        }
        return "";
    }

    static String title(CharSequence value) {
        return bounded(value == null ? "" : value.toString().replaceAll("[\\p{Cntrl}]", " ").trim(), 200);
    }

    static String filename(String name, int index) {
        String value = name == null ? "" : Normalizer.normalize(name, Normalizer.Form.NFKC)
                .replaceAll("[\\p{Cntrl}\\p{Cf}\\\\/\"<>:|?*]+", "_").replaceFirst("^\\.+", "").trim();
        return value.isEmpty() ? "attachment-" + (index + 1) : bounded(value, 180);
    }

    private static String bounded(String value, int max) {
        if (value.length() <= max) return value;
        return value.substring(0, Character.isHighSurrogate(value.charAt(max - 1)) ? max - 1 : max);
    }

    static List<String> tags(String input) {
        var normalized = new LinkedHashSet<String>();
        for (String token : input.trim().split("[,\\s]+")) {
            if (token.isEmpty()) continue;
            String name = Normalizer.normalize(token.replaceFirst("^#", ""), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
            if (!TAG.matcher(name).matches()) throw new IllegalArgumentException("Теги могут содержать буквы, цифры, дефис и подчёркивание.");
            normalized.add(name);
        }
        if (normalized.size() > 50) throw new IllegalArgumentException("Можно указать не больше 50 тегов.");
        return new ArrayList<>(normalized);
    }

    static String mime(byte[] bytes, int count) {
        if (count >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255) return "image/jpeg";
        if (count >= 4 && (bytes[0] & 255) == 137 && ascii(bytes, count, 1, "PNG")) return "image/png";
        if (ascii(bytes, count, 0, "GIF87a") || ascii(bytes, count, 0, "GIF89a")) return "image/gif";
        if (ascii(bytes, count, 0, "RIFF") && ascii(bytes, count, 8, "WEBP")) return "image/webp";
        if (ascii(bytes, count, 4, "ftypavif")) return "image/avif";
        if (ascii(bytes, count, 0, "%PDF-")) return "application/pdf";
        return null;
    }

    private static boolean ascii(byte[] bytes, int count, int offset, String value) {
        if (offset + value.length() > count) return false;
        for (int i = 0; i < value.length(); i++) if (bytes[offset + i] != value.charAt(i)) return false;
        return true;
    }
}
