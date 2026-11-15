package ru.metroom.notebook;

import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/** Converts one already validated public HTML document to Notebook's portable article blocks. */
final class NotebookArticleCapture {
    static final int MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    static final int MAX_IMAGES_BYTES = 8 * 1024 * 1024;
    static final int MAX_IMAGES = 8;
    private static final int MAX_BLOCKS = 400;
    private static final int MAX_PROSE = 200_000;
    private static final int MIN_PROSE = 80;
    private static final int MAX_NODES = 12_000;
    private static final List<String> IMAGE_TYPES = List.of("image/jpeg", "image/png", "image/webp");
    private static final Set<String> BLOCKED = Set.of("aside", "nav", "footer", "script", "style", "template", "noscript",
            "form", "input", "button", "select", "textarea", "iframe", "object", "embed", "svg", "math", "canvas", "dialog", "video", "audio");
    private static final Set<String> ROLES = Set.of("navigation", "complementary", "contentinfo", "search", "dialog", "banner");
    private static final Set<String> CONTAINERS = Set.of("article", "main", "section", "div", "body", "header", "figure");
    private static final Set<String> PROSE = Set.of("p", "blockquote", "li");
    private static final Pattern ANCILLARY = Pattern.compile(
            "(?:^|[\\s._:-])(?:ads?|advert(?:ising|isement)?|sponsored|tracking|tracker|pixel|beacon|avatars?|logos?|sidebar|comments|"
            + "recommend(?:ed|ations?)|related[-_](?:articles|posts|stories|items|content)|social[-_](?:share|links)|author[-_](?:bio|card|profile))(?:$|[\\s._:-])",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern HIDDEN = Pattern.compile("(?i)(?:^|;)\\s*(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden|opacity\\s*:\\s*0)\\s*(?:!important\\s*)?(?:;|$)");
    private static final Pattern SPACES = Pattern.compile("[\\p{Cc}\\p{Z}\\s]+");
    private static final Pattern HEADING = Pattern.compile("h[1-6]");
    private static final Pattern TRACKER = Pattern.compile("(?i)(?:^|[/._-])(?:tracking|tracker|pixel|beacon)(?:$|[/._-])");

    record Image(String key, String mime, byte[] bytes) {}
    record Article(JSONObject payload, List<Image> images) {}
    private record Measure(int length, int linked, int prose, boolean semanticChild) {}
    private record Block(String type, int level, boolean ordered, int depth) {}
    private record Part(StringBuilder value, String href) {}

    private static final Block PARAGRAPH = new Block("paragraph", 0, false, 0);
    private static final class Limit extends RuntimeException {}
    private final HttpUrl url;
    private final long parseDeadline;
    private final LinkedHashMap<String, HttpUrl> imageSources = new LinkedHashMap<>();
    private final JSONArray blocks = new JSONArray();
    private Element main;
    private int bestScore;
    private int nodes;
    private int imageBlocks;
    private int totalText;
    private int proseText;

    private NotebookArticleCapture(HttpUrl url, long deadline) {
        this.url = url;
        parseDeadline = Math.min(deadline, System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(750));
    }

    static Article extract(Document document, HttpUrl url, NotebookLinkPreview.Fetch fetch, long deadline) {
        var extractor = new NotebookArticleCapture(url, deadline);
        try {
            extractor.measure(document.body());
            if (extractor.main == null) return null;
            var parts = new ArrayList<Part>();
            for (Node child : extractor.main.childNodes()) extractor.emit(child, PARAGRAPH, parts, null);
            extractor.flush(PARAGRAPH, parts);
            if (extractor.proseText < MIN_PROSE) return null;
            return extractor.downloadImages(fetch, deadline);
        } catch (Limit | JSONException | IOException invalid) {
            // Keep the metadata and allow the ordinary fallback if an article cannot be delivered in full.
            return null;
        }
    }

    private Measure measure(Node node) {
        checkTime();
        if (++nodes > MAX_NODES) throw new Limit();
        if (node instanceof TextNode text) return new Measure(clean(text.getWholeText()).trim().length(), 0, 0, false);
        if (!(node instanceof Element element) || ignored(element)) return new Measure(0, 0, 0, false);
        int length = 0, linked = 0, prose = 0;
        boolean semanticChild = false;
        for (Node child : node.childNodes()) {
            Measure score = measure(child);
            length += score.length();
            linked += score.linked();
            prose += score.prose();
            semanticChild |= score.semanticChild() || (child instanceof Element tag && semantic(tag) && score.prose() >= MIN_PROSE);
        }
        String tag = element.normalName();
        if (tag.equals("a")) linked = length;
        if (PROSE.contains(tag)) prose = Math.max(prose, length - linked);
        boolean semantic = semantic(element);
        if ((CONTAINERS.contains(tag) || semantic) && prose >= MIN_PROSE && linked * 2 < length && (!semanticChild || semantic)) {
            int weight = element.attr("itemprop").equalsIgnoreCase("articleBody") ? 5
                    : semantic ? 4 : tag.equals("main") || element.attr("role").equals("main") ? 2 : 1;
            int score = prose * weight;
            if (score > bestScore) { bestScore = score; main = element; }
        }
        return new Measure(length, linked, prose, semanticChild);
    }

    private static boolean semantic(Element e) {
        return e.normalName().equals("article") || e.attr("itemprop").equalsIgnoreCase("articleBody");
    }

    private void emit(Node node, Block block, ArrayList<Part> parts, String href) throws JSONException {
        checkTime();
        if (node instanceof TextNode text) {
            append(parts, text.getWholeText(), href);
            return;
        }
        if (!(node instanceof Element element) || ignored(element)) return;
        String tag = element.normalName();
        if (tag.equals("img")) {
            emitImage(element, block, parts);
            return;
        }
        if (tag.equals("ul") || tag.equals("ol")) {
            flush(block, parts);
            int depth = block.type().equals("listItem") ? block.depth() + 1 : block.depth();
            if (depth > 12) throw new Limit();
            var item = new Block("listItem", 0, tag.equals("ol"), depth);
            for (Element child : element.children()) {
                if (child.normalName().equals("li") && !ignored(child)) {
                    for (Node part : child.childNodes()) emit(part, item, parts, null);
                    flush(item, parts);
                }
            }
            return;
        }
        if (tag.equals("br")) { append(parts, " ", href); return; }
        String link = tag.equals("a") ? link(element.attr("href")) : href;
        Block inside = block;
        boolean boundary = CONTAINERS.contains(tag) || tag.equals("li") || tag.equals("p") || tag.equals("figcaption");
        if (HEADING.matcher(tag).matches()) {
            inside = new Block("heading", tag.charAt(1) - '0', false, 0);
            boundary = true;
        } else if (tag.equals("blockquote") && !block.type().equals("listItem")) {
            inside = new Block("quote", 0, false, 0);
            boundary = true;
        }
        if (boundary) flush(block, parts);
        for (Node child : element.childNodes()) emit(child, inside, parts, link);
        if (boundary) flush(inside, parts);
    }

    private String link(String value) {
        if (value.isBlank()) return null;
        HttpUrl checked = NotebookPreviewNetwork.resolve(value, url);
        HttpUrl target = checked == null ? null : url.resolve(value);
        return target == null || target.toString().length() > 2048 ? null : target.toString();
    }

    private void emitImage(Element element, Block block, ArrayList<Part> parts) throws JSONException {
        if (element.hasAttr("onerror") || element.hasAttr("onload") || tiny(element.attr("width")) || tiny(element.attr("height"))) return;
        for (String name : List.of("data-src", "src")) {
            String value = element.attr(name).trim();
            if (value.isEmpty()) continue;
            HttpUrl source = NotebookPreviewNetwork.resolve(value, url);
            if (source == null || source.toString().length() > 2048 || (url.isHttps() && !source.isHttps())
                    || TRACKER.matcher(source.encodedPath()).find()) continue;
            if (++imageBlocks > MAX_IMAGES) throw new Limit();
            flush(block, parts);
            String key = sha256(source.toString());
            imageSources.putIfAbsent(key, source);
            String alt = NotebookShareInput.title(clean(element.attr("alt")));
            addBlock(new JSONObject().put("type", "image").put("key", key).put("alt", alt));
            return;
        }
    }

    private static boolean tiny(String value) {
        return value.matches("[0-9]{1,2}") && Integer.parseInt(value) < 32;
    }

    private void append(ArrayList<Part> parts, String value, String href) {
        String text = clean(value);
        if (text.isEmpty()) return;
        Part last = parts.isEmpty() ? null : parts.get(parts.size() - 1);
        if (last == null || !java.util.Objects.equals(last.href(), href)) {
            if (parts.size() >= 200) throw new Limit();
            last = new Part(new StringBuilder(), href);
            parts.add(last);
        }
        last.value().append(text);
        if (last.value().length() > 16_384) throw new Limit();
    }

    private void flush(Block block, ArrayList<Part> parts) throws JSONException {
        while (!parts.isEmpty() && parts.get(0).value().toString().isBlank()) parts.remove(0);
        while (!parts.isEmpty() && parts.get(parts.size() - 1).value().toString().isBlank()) parts.remove(parts.size() - 1);
        if (parts.isEmpty()) return;
        var content = new JSONArray();
        for (int i = 0; i < parts.size(); i++) {
            var part = parts.get(i);
            String text = part.value().toString();
            if (i == 0) text = text.stripLeading();
            if (i == parts.size() - 1) text = text.stripTrailing();
            if (part.href() == null && !block.type().equals("heading")) proseText += text.trim().length();
            totalText += text.length() + (part.href() == null ? 0 : part.href().length());
            if (totalText > MAX_PROSE) throw new Limit();
            content.put(new JSONObject().put("type", part.href() == null ? "text" : "link").put("text", text).put("href", part.href()));
        }
        var result = new JSONObject().put("type", block.type()).put("content", content);
        if (block.level() > 0) result.put("level", block.level());
        if (block.type().equals("listItem")) result.put("ordered", block.ordered()).put("depth", block.depth());
        addBlock(result);
        parts.clear();
    }

    private void addBlock(JSONObject block) {
        if (blocks.length() >= MAX_BLOCKS) throw new Limit();
        blocks.put(block);
    }

    private Article downloadImages(NotebookLinkPreview.Fetch fetch, long deadline) throws IOException, JSONException {
        int remaining = MAX_IMAGES_BYTES;
        var manifest = new JSONArray();
        var images = new ArrayList<Image>();
        for (var asset : imageSources.entrySet()) {
            if (remaining <= 0 || Thread.currentThread().isInterrupted()) return null;
            long limit = Math.min(deadline, System.nanoTime() + TimeUnit.SECONDS.toNanos(4));
            var body = fetch.read(asset.getValue(), Math.min(MAX_IMAGE_BYTES, remaining), IMAGE_TYPES, true, limit);
            byte[] bytes = body.bytes();
            if (bytes.length == 0 || bytes.length > Math.min(MAX_IMAGE_BYTES, remaining)
                    || !body.type().equals(NotebookShareInput.mime(bytes, bytes.length))) return null;
            remaining -= bytes.length;
            images.add(new Image(asset.getKey(), body.type(), bytes));
            manifest.put(new JSONObject().put("key", asset.getKey()).put("sourceUrl", asset.getValue().toString()));
        }
        return new Article(new JSONObject().put("blocks", blocks).put("images", manifest), List.copyOf(images));
    }

    private void checkTime() {
        if (Thread.currentThread().isInterrupted() || System.nanoTime() > parseDeadline) throw new Limit();
    }

    private static boolean ignored(Element e) {
        return BLOCKED.contains(e.normalName()) || ROLES.contains(e.attr("role")) || e.hasAttr("hidden") || e.hasAttr("inert")
                || e.attr("aria-hidden").equalsIgnoreCase("true") || HIDDEN.matcher(e.attr("style")).find()
                || e.classNames().stream().anyMatch(Set.of("hidden", "sr-only", "visually-hidden", "d-none")::contains)
                || ANCILLARY.matcher(e.id() + " " + e.className()).find()
                || (e.normalName().equals("details") && !e.hasAttr("open"));
    }

    private static String clean(String text) { return SPACES.matcher(text).replaceAll(" "); }

    private static String sha256(String value) {
        try {
            var bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            var result = new StringBuilder(64);
            for (byte b : bytes) result.append(Character.forDigit((b & 255) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
