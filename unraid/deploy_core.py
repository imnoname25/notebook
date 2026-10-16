"""Pure validation. No Docker, shell, network, or filesystem mutations."""
import hashlib
import json
import re
import xml.etree.ElementTree as ET

REPOSITORY = "imnoname25/notebook"
IMAGE = "ghcr.io/imnoname25/notebook@sha256:"
UPLOADS = "/mnt/user/appdata/note/uploads"
BACKUPS = "/mnt/user/appdata/note/backup"
EXPECTED_ENV = {"APP_ORIGIN": "http://192.168.110.11:3100", "TZ": "Asia/Yekaterinburg", "PUID": "99", "PGID": "100", "UMASK": "002"}


class StopError(ValueError):
    """Only fixed diagnostic codes, never runtime exception contents."""


def require(condition, code):
    if not condition:
        raise StopError(code)


def digest(value):
    require(isinstance(value, str) and re.fullmatch(re.escape(IMAGE) + "[0-9a-f]{64}", value), "invalid-image-digest")
    return value


def checksum(value):
    require(isinstance(value, str) and re.fullmatch("[0-9a-f]{64}", value), "invalid-checksum")
    return value


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def fingerprint(value):
    return hash_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def manifest(value):
    require(isinstance(value, dict) and value.get("format") == 1 and value.get("repository") == REPOSITORY, "invalid-manifest")
    digest(value.get("image"))
    require(re.fullmatch("[0-9a-f]{40}", value.get("sha", "")), "invalid-source-sha")
    version = value.get("version", "")
    require(re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version), "invalid-version")
    require(value.get("ref") == "refs/tags/v" + version, "stable-release-required")
    migrations = value.get("migrations")
    require(isinstance(migrations, list) and len(migrations) < 10000, "invalid-migrations")
    names = []
    for row in migrations:
        require(isinstance(row, dict) and re.fullmatch("[a-zA-Z0-9_]+", row.get("name", "")), "invalid-migration-name")
        checksum(row.get("sha256"))
        names.append(row["name"])
    require(names == sorted(set(names)), "migration-order-or-duplicates")
    return value


def migration_delta(previous, candidate):
    require(candidate[:len(previous)] == previous, "existing-migrations-changed-or-removed")
    return candidate[len(previous):]


def runtime(info):
    require(info.get("Name") == "/notebook", "wrong-container")
    env = {}
    for item in info["Config"]["Env"]:
        key, _, value = item.partition("=")
        require(key not in env, "duplicate-environment-key")
        env[key] = value
    require(all(env.get(key) == value for key, value in EXPECTED_ENV.items()), "runtime-settings-drift")
    require(env.get("DATABASE_URL") and env.get("SETTINGS_ENCRYPTION_KEY"), "missing-existing-secrets")
    require(env.get("FIX_PERMISSIONS", "0").lower() not in ("1", "true", "yes"), "recursive-permissions-repair-must-be-disabled")
    mounts = {m["Destination"]: (m["Source"], m["Type"], m["RW"]) for m in info["Mounts"]}
    require(mounts.get("/data/uploads") == (UPLOADS, "bind", True), "uploads-mount-drift")
    require(mounts.get("/data/backups") == (BACKUPS, "bind", True), "backups-mount-drift")
    require(set(info["NetworkSettings"]["Networks"]) == {"notebook-net"}, "network-drift")
    ports = info["HostConfig"]["PortBindings"]
    require(set(ports) == {"3000/tcp"} and ports["3000/tcp"] and all(p["HostPort"] == "3100" for p in ports["3000/tcp"]), "port-drift")
    host = info["HostConfig"]
    require(not host.get("Privileged") and not any(m["Destination"].endswith("docker.sock") for m in info["Mounts"]), "unsafe-runtime")
    # Hash all effective host settings and secrets privately; never serialize inspect/Env to logs.
    return fingerprint({"env": {k: env[k] for k in [*EXPECTED_ENV, "DATABASE_URL", "SETTINGS_ENCRYPTION_KEY"]}, "mounts": sorted(mounts.items()), "host": host})


def template(xml, info):
    require(b"<!DOCTYPE" not in xml and b"<!ENTITY" not in xml, "unsafe-xml")
    root = ET.fromstring(xml)
    require(root.tag == "Container" and root.get("version") == "2", "unsupported-template")
    require(root.findtext("Name") == "notebook" and root.findtext("Network") == "notebook-net", "template-identity-drift")
    require(root.findtext("Privileged") == "false" and len(root.findall("Repository")) == 1, "unsafe-template")
    require(root.findtext("Repository") == info["Config"]["Image"], "template-image-drift")
    configs = root.findall("Config")
    targets = [c.get("Target") for c in configs]
    require(len(targets) == len(set(targets)), "duplicate-template-target")
    values = {c.get("Target"): c.text or "" for c in configs}
    actual_env = dict(item.split("=", 1) for item in info["Config"]["Env"] if "=" in item)
    for key in [*EXPECTED_ENV, "DATABASE_URL", "SETTINGS_ENCRYPTION_KEY"]:
        require(values.get(key) == actual_env.get(key), "template-environment-drift")
    require(values.get("/data/uploads") == UPLOADS and values.get("/data/backups") == BACKUPS and values.get("3000") == "3100", "template-path-or-port-drift")
    return hash_bytes(xml)


def pinned_template(xml, image):
    digest(image)
    require(len(re.findall(rb"<Repository>[^<]*</Repository>", xml)) == 1, "unsupported-repository-element")
    return re.sub(rb"<Repository>[^<]*</Repository>", ("<Repository>" + image + "</Repository>").encode(), xml)


def template_fingerprint(xml):
    root = ET.fromstring(xml)
    root.find("Repository").text = "IMAGE_REFERENCE"
    return fingerprint(ET.canonicalize(ET.tostring(root, encoding="unicode"), strip_text=True))


def review(value, state):
    for key in ["previous_image", "candidate_image", "dump_sha256", "uploads_sha256", "migration_manifest_sha256"]:
        require(value.get(key) == state.get(key), "review-does-not-match-preparation")
    require(value.get("migration_review_passed") is True and value.get("upgrade_rehearsal_passed") is True and value.get("rollback_rehearsal_passed") is True, "rehearsal-required")


def approved_request(value, state, review_sha):
    require(value.get("format") == 1 and value.get("repository") == REPOSITORY, "invalid-approval")
    require(value.get("previous_image") == state["previous_image"] and value.get("image") == state["candidate_image"], "approval-image-pair-mismatch")
    require(value.get("review_sha256") == review_sha and value.get("manifest_sha256") == state["migration_manifest_sha256"], "approval-review-mismatch")
