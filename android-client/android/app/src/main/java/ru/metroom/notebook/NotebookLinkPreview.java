package ru.metroom.notebook;

import okhttp3.HttpUrl;
import org.json.JSONException;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

final class NotebookLinkPreview {
    static final int MAX_COVER_BYTES = 2 * 1024 * 1024;
    private static final List<String> IMAGES = List.of("image/jpeg", "image/png", "image/webp");
    private static final List<String> HTML = List.of("text/html", "application/xhtml+xml");
    private static final List<String> JSON = List.of("application/json");
    private static final List<String> NOEMBED_JSON = List.of("application/json", "text/javascript");
    private static final Set<String> YOUTUBE = Set.of("youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com");
    private static final Set<String> YOUTUBE_IMAGES = Set.of("i.ytimg.com", "i1.ytimg.com", "i2.ytimg.com", "i3.ytimg.com", "i4.ytimg.com");
    private static final Pattern VIDEO_ID = Pattern.compile("[A-Za-z0-9_-]{11}");
    private static final Pattern VIDEO_PATH = Pattern.compile("^/(?:shorts|embed|v|live)/([A-Za-z0-9_-]{11})/?$");
    private static final Pattern CHARSET = Pattern.compile("(?i)charset\\s*=\\s*[\"']?([\\w-]+)");
    private static final Pattern GATE_TITLE = Pattern.compile(
            "^(?:(?:sign[ -]?in|log[ -]?in|authentication required|вход|авторизация)(?:\\s*[|–—:].*)?"
            + "|(?:error\\s+)?(?:401|403|404|451|503)(?:\\s*[-–—:]?\\s*(?:unauthorized|forbidden|not found|unavailable for legal reasons|service unavailable))?"
            + "|(?:ваш браузер устарел|браузер не поддерживается|(?:your )?browser is (?:out of date|outdated|not supported)"
            + "|unsupported browser|update your browser(?: to continue)?|just a moment|checking your browser|verify (?:that )?you (?:are|’re|'re) human"
            + "|access denied|permission denied|forbidden|page not found|service unavailable"
            + "|доступ (?:запрещ[её]н|ограничен)|проверка безопасности|страница не найдена|сервис временно недоступен"
            + "|подтвердите,? что вы (?:человек|не робот))[.!… ]*(?:\\|\\s*[^|]+)?)$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern GATE_URL = Pattern.compile(
            "^/(?:(?:accounts|auth)/)?(?:login|signin|log-in|sign-in|checkpoint|captcha)(?:[/.]|$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern GATE_MARKER = Pattern.compile(
            "(?:^|\\W)(?:paywall|metered[-_]wall|g-recaptcha|h-captcha|hcaptcha|cf-turnstile|cf-challenge|challenge-form|challenge-platform|captcha)(?:\\W|$)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern ANCILLARY_IMAGE = Pattern.compile(
            "(?:^|[ ._:/-])(?:avatar|logo|advert(?:isement|ising)?|banner|tracker|pixel)(?:$|[ ._:/-])",
            Pattern.CASE_INSENSITIVE);

    interface Fetch {
        NotebookPreviewNetwork.Body read(HttpUrl url, int limit, List<String> types, boolean redirects, long deadline) throws IOException;
    }

    record Result(String kind, String title, String description, String siteName, byte[] image, String mime) {}
    private record Metadata(String title, String description, String siteName, HttpUrl cover) {}

    private final Fetch fetch;
    NotebookLinkPreview(Fetch fetch) { this.fetch = fetch; }

    Result get(String original) throws IOException {
        HttpUrl url = NotebookPreviewNetwork.resolve(original, null);
        if (url == null) throw new NotebookPreviewNetwork.Unavailable(false);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(19);
        String kind = kind(url);
        Metadata fields;
        if (isYoutube(url)) {
            String id = youtubeId(url);
            if (id == null) throw new NotebookPreviewNetwork.Unavailable(false);
            fields = youtube(id, deadline);
        } else {
            if (isGateUrl(url)) throw new NotebookPreviewNetwork.Unavailable(false, true);
            var body = fetch.read(url, 512 * 1024, HTML, true, deadline);
            fields = parseHtml(body);
        }

        byte[] image = null;
        String mime = null;
        if (fields.cover() != null) {
            try {
                var body = fetch.read(fields.cover(), MAX_COVER_BYTES, IMAGES, !isYoutube(url), deadline);
                if (body.bytes().length <= MAX_COVER_BYTES
                        && body.type().equals(NotebookShareInput.mime(body.bytes(), body.bytes().length))) {
                    image = body.bytes();
                    mime = body.type();
                }
            } catch (IOException ignored) {
                // The title and description remain usable when the image host is unavailable.
            }
        }
        return new Result(kind, fields.title(), fields.description(), fields.siteName(), image, mime);
    }

    private Metadata youtube(String id, long deadline) throws IOException {
        String source = "https://www.youtube.com/watch?v=" + id;
        try {
            return youtubeJson("https://www.youtube.com/oembed", source, id, false, deadline);
        } catch (IOException official) {
            if (Thread.currentThread().isInterrupted()) throw official;
            if (official instanceof NotebookPreviewNetwork.Unavailable failure && failure.restricted) throw official;
            try {
                return youtubeJson("https://noembed.com/embed", source, id, true, deadline);
            } catch (NotebookPreviewNetwork.Unavailable alternative) {
                // Preserve a transient official failure when the fallback lacks data.
                if (alternative.retryable || official instanceof NotebookPreviewNetwork.Unavailable failure && !failure.retryable) {
                    throw alternative;
                }
                throw official;
            }
        }
    }

    private Metadata youtubeJson(String endpoint, String source, String id, boolean fallback, long deadline) throws IOException {
        HttpUrl url = HttpUrl.get(endpoint).newBuilder().addQueryParameter("url", source).addQueryParameter("format", "json").build();
        byte[] bytes = fetch.read(url, 64 * 1024, fallback ? NOEMBED_JSON : JSON, false, deadline).bytes();
        try {
            var data = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String type = data.optString("type");
            if (data.has("error") || !("video".equals(type) || (fallback && "rich".equals(type) && "YouTube".equals(data.opt("provider_name"))))) {
                throw new JSONException("No video metadata");
            }
            String title = clean(data.opt("title"), 300);
            String description = clean(data.opt("description"), 1000);
            String author = clean(data.opt("author_name"), 150);
            if (title != null && GATE_TITLE.matcher(title).matches()) throw new NotebookPreviewNetwork.Unavailable(false, true);
            HttpUrl cover = imageUrl(data.opt("thumbnail_url"), null);
            if (cover == null || !YOUTUBE_IMAGES.contains(cover.host())
                    || (!cover.encodedPath().startsWith("/vi/" + id + "/") && !cover.encodedPath().startsWith("/vi_webp/" + id + "/"))) {
                cover = null;
            } else {
                cover = cover.newBuilder().scheme("https").host("i.ytimg.com").query(null).build();
            }
            if (title == null && author == null && cover == null && description == null) throw new JSONException("Empty preview");
            return new Metadata(title, description, author == null ? "YouTube" : "YouTube · " + author, cover);
        } catch (JSONException invalid) { throw new NotebookPreviewNetwork.Unavailable(false); }
    }

    static boolean isGateUrl(HttpUrl url) { return GATE_URL.matcher(url.encodedPath()).find(); }

    private static Metadata parseHtml(NotebookPreviewNetwork.Body body) throws IOException {
        if (isGateUrl(body.url())) throw new NotebookPreviewNetwork.Unavailable(false, true);
        var match = CHARSET.matcher(body.contentType());
        String charset = null;
        if (match.find()) {
            try { charset = Charset.forName(match.group(1)).name(); }
            catch (IllegalArgumentException ignored) { /* jsoup tries the document charset. */ }
        }
        Document document = Jsoup.parse(new ByteArrayInputStream(body.bytes()), charset, "", Parser.htmlParser().setMaxDepth(96));
        boolean publicArticle = document.select("article p,main p,[itemprop=articleBody] p").stream()
                .anyMatch(paragraph -> paragraph.text().length() >= 80
                        && paragraph.closest("aside,nav,footer,form,template,[hidden],[inert],[aria-hidden=true]") == null);
        for (Element element : document.select("title,h1,input[type=password],[id],[class],[src],[data-paywall],script[type=application/ld+json]")) {
            String markers = element.id() + " " + element.className() + " " + element.attr("src");
            if (GATE_MARKER.matcher(markers).find()
                    || (element.hasAttr("data-paywall") && !"false".equalsIgnoreCase(element.attr("data-paywall")))
                    || (element.normalName().equals("script") && element.data().matches("(?s).*\"isAccessibleForFree\"\\s*:\\s*(?:false|\"false\").*"))) {
                throw new NotebookPreviewNetwork.Unavailable(false, true);
            }
            boolean primary = element.closest("aside,nav,footer,template,[hidden],[inert],[role=complementary],[role=navigation],[aria-hidden=true]") == null;
            boolean signInPage = element.is("input[type=password]") && (!publicArticle
                    || element.closest("article,main,[itemprop=articleBody]") != null);
            if (primary && (signInPage || element.is("title,h1") && GATE_TITLE.matcher(element.text()).matches())) {
                throw new NotebookPreviewNetwork.Unavailable(false, true);
            }
        }
        Element head = document.head();
        String title = clean(tag(head, "og:title", "twitter:title"), 300);
        if (title != null && GATE_TITLE.matcher(title).matches()) throw new NotebookPreviewNetwork.Unavailable(false, true);
        String description = clean(tag(head, "og:description", "twitter:description"), 1000);
        String site = clean(tag(head, "og:site_name", "twitter:site"), 160);
        Set<HttpUrl> auxiliaryImages = new HashSet<>();
        for (Element element : document.select("aside img,nav img,footer img,img[class],img[id],[class*=avatar] img,[class*=logo] img,[class*=advert] img")) {
            for (String attribute : List.of("src", "data-src")) {
                HttpUrl image = imageUrl(element.attr(attribute), body.url());
                if (image != null && (element.closest("aside,nav,footer,[class*=avatar],[class*=logo],[class*=advert]") != null
                        || ANCILLARY_IMAGE.matcher(element.className() + " " + element.id()).find())) auxiliaryImages.add(image);
            }
        }
        HttpUrl cover = null;
        for (String name : List.of("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src")) {
            for (Element meta : head.select("meta[content]")) {
                if (!metadataName(meta).equals(name)) continue;
                HttpUrl candidate = imageUrl(meta.attr("content"), body.url());
                if (candidate != null && (!body.url().isHttps() || candidate.isHttps())
                        && !auxiliaryImages.contains(candidate) && !ANCILLARY_IMAGE.matcher(candidate.encodedPath()).find()
                        && (!name.endsWith(":secure_url") || candidate.isHttps())) {
                    cover = candidate;
                    break;
                }
            }
            if (cover != null) break;
        }
        return new Metadata(title, description, site, cover);
    }

    private static String tag(Element head, String... names) {
        for (String name : names) {
            for (Element meta : head.select("meta[content]")) {
                String value = meta.attr("content");
                if (metadataName(meta).equals(name) && !value.isBlank()) return value;
            }
        }
        return null;
    }

    private static String metadataName(Element meta) {
        return (meta.hasAttr("property") ? meta.attr("property") : meta.attr("name")).trim().toLowerCase(Locale.ROOT);
    }

    private static HttpUrl imageUrl(Object value, HttpUrl base) {
        return value instanceof String ? NotebookPreviewNetwork.resolve(((String) value).trim(), base) : null;
    }

    private static String clean(Object value, int limit) {
        if (!(value instanceof String)) return null;
        String text = ((String) value).replaceAll("[\\p{Cntrl}\\p{Cf}\\p{Z}]+", " ").trim();
        if (text.isEmpty()) return null;
        if (text.length() <= limit) return text;
        return text.substring(0, Character.isHighSurrogate(text.charAt(limit - 1)) ? limit - 1 : limit).trim();
    }

    private static String host(HttpUrl url) { return url.host().replaceFirst("^www\\.", "").replaceFirst("\\.$", ""); }
    private static boolean isYoutube(HttpUrl url) { return YOUTUBE.contains(host(url)); }

    static String youtubeId(HttpUrl url) {
        if (!isYoutube(url)) return null;
        String path = url.encodedPath(), id = null;
        if ("youtu.be".equals(host(url))) id = path.substring(1).replaceFirst("/$", "");
        else if (path.matches("/watch/?")) id = url.queryParameter("v");
        else {
            var match = VIDEO_PATH.matcher(path);
            if (match.matches()) id = match.group(1);
        }
        return id != null && VIDEO_ID.matcher(id).matches() ? id : null;
    }

    private static String kind(HttpUrl url) {
        String host = host(url);
        if (isYoutube(url)) return "video";
        if (Set.of("threads.com", "threads.net").contains(host)) return "social";
        if (Set.of("vk.com", "m.vk.com", "vk.ru", "m.vk.ru", "vkvideo.ru", "m.vkvideo.ru").contains(host)
                && (url.encodedPath().matches("^/(?:clip-?\\d+_\\d+/?|clips(?:/.*)?)$")
                || (url.queryParameter("z") != null && url.queryParameter("z").matches("^clip-?\\d+_\\d+(?:/.*)?$")))) return "video";
        return "article";
    }
}
