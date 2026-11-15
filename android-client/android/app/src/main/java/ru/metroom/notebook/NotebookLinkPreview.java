package ru.metroom.notebook;

import okhttp3.HttpUrl;
import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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

    record Result(String kind, String title, String description, String siteName, byte[] image, String mime,
                  String canonical, String author, String publishedAt, String videoId, boolean expectedCover,
                  Map<String, String> provenance) {
        Result(String kind, String title, String description, String siteName, byte[] image, String mime) {
            this(kind, title, description, siteName, image, mime, null, null, null, null, image != null, Map.of());
        }
    }
    private record Metadata(String kind, String title, String description, String siteName, HttpUrl cover,
                            String canonical, String author, String publishedAt, Map<String, String> provenance) {}

    private final Fetch fetch;
    NotebookLinkPreview(Fetch fetch) { this.fetch = fetch; }

    Result get(String original) throws IOException {
        return get(original, false);
    }

    Result get(String original, boolean publicVideoDescription) throws IOException {
        HttpUrl url = NotebookPreviewNetwork.resolve(original, null);
        if (url == null) throw new NotebookPreviewNetwork.Unavailable(false);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(19);
        String videoId = youtubeId(url);
        Metadata fields;
        boolean usedVideoPage = false;
        if (isYoutube(url)) {
            if (videoId == null) throw new NotebookPreviewNetwork.Unavailable(false);
            try {
                fields = youtube(videoId, deadline);
            } catch (IOException provider) {
                if (!publicVideoDescription || Thread.currentThread().isInterrupted()
                        || (provider instanceof NotebookPreviewNetwork.Unavailable denied && denied.restricted)) throw provider;
                String canonical = videoUrl(videoId);
                var body = fetch.read(HttpUrl.get(canonical), 512 * 1024, HTML, false, deadline);
                var page = parseHtml(body, "video");
                fields = new Metadata("video", page.title(), page.description(), page.siteName(), youtubeCover(page.cover(), videoId),
                        canonical, page.author(), page.publishedAt(), page.provenance());
                usedVideoPage = true;
            }
        } else {
            if (isGateUrl(url)) throw new NotebookPreviewNetwork.Unavailable(false, true);
            var body = fetch.read(url, 512 * 1024, HTML, true, deadline);
            fields = parseHtml(body, kind(url));
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
        String description = fields.description();
        String author = fields.author();
        String publishedAt = fields.publishedAt();
        Map<String, String> attribution = new HashMap<>(fields.provenance());
        if (publicVideoDescription && !usedVideoPage && videoId != null && (description == null || author == null || publishedAt == null)
                && deadline - System.nanoTime() > TimeUnit.SECONDS.toNanos(1)) {
            try {
                var body = fetch.read(HttpUrl.get(fields.canonical()), 512 * 1024, HTML, false, deadline);
                var page = parseHtml(body, "video");
                if (description == null && page.description() != null) {
                    description = page.description();
                    attribution.put("description", page.provenance().get("description"));
                }
                if (author == null && page.author() != null) {
                    author = page.author();
                    attribution.put("author", page.provenance().get("author"));
                }
                if (publishedAt == null && page.publishedAt() != null) {
                    publishedAt = page.publishedAt();
                    attribution.put("publishedAt", page.provenance().get("publishedAt"));
                }
            } catch (IOException ignored) { /* The optional page may be inaccessible while oEmbed works. */ }
        }
        return new Result(fields.kind(), fields.title(), description, fields.siteName(), image, mime,
                fields.canonical(), author, publishedAt, videoId, videoId != null || fields.cover() != null, attribution);
    }

    private static String videoUrl(String id) { return "https://www.youtube.com/watch?v=" + id; }

    private Metadata youtube(String id, long deadline) throws IOException {
        String source = videoUrl(id);
        try {
            return youtubeJson("https://www.youtube.com/oembed", source, id, false, deadline);
        } catch (IOException official) {
            if (Thread.currentThread().isInterrupted()) throw official;
            if (official instanceof NotebookPreviewNetwork.Unavailable failure && failure.restricted) throw official;
            try {
                return youtubeJson("https://noembed.com/embed", source, id, true, deadline);
            } catch (NotebookPreviewNetwork.Unavailable alternative) {
                if (alternative.restricted) throw alternative;
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
            String raw = new String(bytes, StandardCharsets.UTF_8);
            if (!withinJsonDepth(raw)) throw new JSONException("Invalid JSON");
            var json = new JSONTokener(raw);
            if (!(json.nextValue() instanceof JSONObject data) || json.nextClean() != 0) throw new JSONException("Invalid JSON");
            String type = data.optString("type");
            if (data.has("error") || (fallback && !"YouTube".equals(data.opt("provider_name")))
                    || !("video".equals(type) || (fallback && "rich".equals(type)))) {
                throw new JSONException("No video metadata");
            }
            String title = clean(data.opt("title"), 300);
            String description = clean(data.opt("description"), 1000);
            String author = clean(data.opt("author_name"), 150);
            if (title != null && GATE_TITLE.matcher(title).matches()) throw new NotebookPreviewNetwork.Unavailable(false, true);
            HttpUrl cover = youtubeCover(imageUrl(data.opt("thumbnail_url"), null), id);
            if (title == null && author == null && cover == null && description == null) throw new JSONException("Empty preview");
            String provider = fallback ? "noembed" : "oembed";
            return new Metadata("video", title, description, author == null ? "YouTube" : "YouTube · " + author, cover,
                    source, author, null, Map.of("title", provider, "description", provider, "author", provider,
                    "siteName", provider, "canonicalUrl", "url", "contentType", "url", "videoId", "url", "cover", provider));
        } catch (JSONException invalid) { throw new NotebookPreviewNetwork.Unavailable(false); }
    }

    private static HttpUrl youtubeCover(HttpUrl cover, String id) {
        if (cover == null || !YOUTUBE_IMAGES.contains(cover.host())
                || (!cover.encodedPath().startsWith("/vi/" + id + "/") && !cover.encodedPath().startsWith("/vi_webp/" + id + "/"))) return null;
        return cover.newBuilder().scheme("https").host("i.ytimg.com").query(null).build();
    }

    static boolean isGateUrl(HttpUrl url) { return GATE_URL.matcher(url.encodedPath()).find(); }

    private static Metadata parseHtml(NotebookPreviewNetwork.Body body, String kind) throws IOException {
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
        Structured structured = structured(document);
        Map<String, String> sources = new HashMap<>();
        String ogType = tag(head, "og:type");
        if ("article".equals(kind) && structured != null && ("product".equals(structured.kind())
                || ("video".equals(structured.kind()) && !publicArticle && !"article".equals(ogType)))) {
            kind = structured.kind();
            sources.put("contentType", "schema");
        } else if ("article".equals(kind) && ogType != null && ogType.startsWith("video.")) {
            kind = "video";
            sources.put("contentType", "opengraph");
        } else sources.put("contentType", "url");
        String qualified = structured == null ? null : clean(structured.value().opt("headline"), 300);
        if (qualified == null && structured != null) qualified = clean(structured.value().opt("name"), 300);
        String openGraph = clean(tag(head, "og:title"), 300);
        String twitter = clean(tag(head, "twitter:title"), 300);
        String html = clean(document.title(), 300);
        String title = "product".equals(kind)
                ? choose(sources, "title", "schema", qualified, "opengraph", openGraph, "twitter", twitter, "html", html)
                : choose(sources, "title", "opengraph", openGraph, "schema", qualified, "twitter", twitter, "html", html);
        if (title != null && GATE_TITLE.matcher(title).matches()) throw new NotebookPreviewNetwork.Unavailable(false, true);
        String description = choose(sources, "description", "opengraph", clean(tag(head, "og:description"), 1000),
                "schema", structured == null ? null : clean(structured.value().opt("description"), 1000),
                "twitter", clean(tag(head, "twitter:description"), 1000), "html", clean(tag(head, "description"), 1000));
        String site = choose(sources, "siteName", "opengraph", clean(tag(head, "og:site_name"), 160),
                "twitter", clean(tag(head, "twitter:site"), 160));
        String author = choose(sources, "author", "schema", structured == null ? null : named(structured.value().opt("author")),
                "html", clean(tag(head, "author"), 160));
        String publishedAt = choose(sources, "publishedAt", "opengraph", date(tag(head, "article:published_time")),
                "schema", structured == null ? null : date(clean(structured.value().opt("datePublished"), 64)));
        var canonicalTag = head.selectFirst("link[rel=canonical][href]");
        HttpUrl canonical = imageUrl(canonicalTag == null ? null : canonicalTag.attr("href"), body.url());
        String canonicalSource = "html";
        if (canonical == null) {
            canonical = imageUrl(tag(head, "og:url"), body.url());
            canonicalSource = "opengraph";
        }
        if (canonical != null && host(canonical).equals(host(body.url())) && (!body.url().isHttps() || canonical.isHttps())) {
            sources.put("canonicalUrl", canonicalSource);
        } else canonical = null;
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
                    sources.put("cover", name.startsWith("og:") ? "opengraph" : "twitter");
                    break;
                }
            }
            if (cover != null) break;
        }
        if (cover == null && structured != null) {
            HttpUrl candidate = imageUrl(imageValue(structured.value().opt("image")), body.url());
            if (candidate != null && (!body.url().isHttps() || candidate.isHttps()) && !auxiliaryImages.contains(candidate)
                    && !ANCILLARY_IMAGE.matcher(candidate.encodedPath()).find()) {
                cover = candidate;
                sources.put("cover", "schema");
            }
        }
        return new Metadata(kind, title, description, site, cover, canonical == null ? null : canonical.toString(), author, publishedAt, sources);
    }

    private record Structured(String kind, JSONObject value, int priority) {}

    private static Structured structured(Document document) {
        Structured best = null;
        int inspected = 0;
        for (Element script : document.select("script[type=application/ld+json]")) {
            if (inspected++ >= 24) break;
            if (script.data().length() > 64 * 1024 || !withinJsonDepth(script.data())) continue;
            try {
                Structured candidate = structuredNode(new JSONTokener(script.data()).nextValue(), 0);
                if (candidate != null && (best == null || candidate.priority() > best.priority())) best = candidate;
            } catch (JSONException ignored) { /* Invalid JSON-LD is optional. */ }
        }
        return best;
    }

    private static boolean withinJsonDepth(String data) {
        int depth = 0;
        boolean quoted = false;
        for (int index = 0; index < data.length(); index++) {
            char value = data.charAt(index);
            if (quoted && value == '\\') { index++; continue; }
            if (value == '"') quoted = !quoted;
            if (quoted) continue;
            if ((value == '{' || value == '[') && ++depth > 32) return false;
            if (value == '}' || value == ']') depth--;
        }
        return true;
    }

    private static Structured structuredNode(Object node, int depth) {
        if (depth > 4) return null;
        Structured best = null;
        if (node instanceof JSONArray array) {
            for (int item = 0; item < Math.min(32, array.length()); item++) {
                Structured candidate = structuredNode(array.opt(item), depth + 1);
                if (candidate != null && (best == null || candidate.priority() > best.priority())) best = candidate;
            }
        } else if (node instanceof JSONObject object) {
            String type = object.optString("@type", "");
            if (type.matches(".*(?:^|[\\W])Product(?:$|[\\W]).*")) return new Structured("product", object, 3);
            if (type.matches(".*(?:Article|BlogPosting|DiscussionForumPosting).*")) return new Structured("article", object, 2);
            if (type.contains("VideoObject")) return new Structured("video", object, 1);
            best = structuredNode(object.opt("mainEntity"), depth + 1);
            if (best == null) best = structuredNode(object.opt("@graph"), depth + 1);
        }
        return best;
    }

    private static String choose(Map<String, String> sources, String field, String... candidates) {
        int first = -1;
        for (int index = 0; index < candidates.length; index += 2) {
            String value = candidates[index + 1];
            if (value == null) continue;
            if (first < 0) first = index;
            if (!field.equals("title") || !(value.endsWith("…") || value.endsWith("..."))) {
                first = index;
                break;
            }
        }
        if (first < 0) return null;
        sources.put(field, candidates[first]);
        return candidates[first + 1];
    }

    private static String named(Object value) {
        if (value instanceof JSONArray list) value = list.opt(0);
        return clean(value instanceof JSONObject object ? object.opt("name") : value, 160);
    }

    private static Object imageValue(Object value) {
        if (value instanceof JSONArray list) value = list.opt(0);
        return value instanceof JSONObject object ? object.optString("url", object.optString("contentUrl", "")) : value;
    }

    private static String date(String value) {
        if (value == null) return null;
        try {
            return value.length() == 10 ? LocalDate.parse(value).toString() : OffsetDateTime.parse(value).toInstant().toString();
        } catch (DateTimeParseException invalid) { return null; }
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
