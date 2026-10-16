import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import approval
import deploy
from deploy_core import BACKUPS, UPLOADS, EXPECTED_ENV, IMAGE, approved_request, digest, hash_bytes, manifest, migration_delta, pinned_template, review, runtime, template, template_fingerprint

OLD = IMAGE + "a" * 64
NEW = IMAGE + "b" * 64


def container():
    values = {**EXPECTED_ENV, "DATABASE_URL": "unit-test-value", "SETTINGS_ENCRYPTION_KEY": "unit-test-key"}
    return {"Id": "container-id", "Name": "/notebook", "Image": "sha256:" + "c" * 64,
            "Config": {"Image": OLD, "Env": [k + "=" + v for k, v in values.items()]},
            "Mounts": [{"Source": UPLOADS, "Destination": "/data/uploads", "Type": "bind", "RW": True}, {"Source": BACKUPS, "Destination": "/data/backups", "Type": "bind", "RW": True}],
            "NetworkSettings": {"Networks": {"notebook-net": {}}},
            "HostConfig": {"PortBindings": {"3000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3100"}]}, "Privileged": False},
            "State": {"Running": False, "StartedAt": "before", "FinishedAt": "stopped"}}


def xml(info):
    configs = ''.join('<Config Type="Variable" Target="' + k + '">' + v + '</Config>' for k, v in (e.split('=', 1) for e in info["Config"]["Env"]))
    configs += '<Config Target="/data/uploads">' + UPLOADS + '</Config><Config Target="/data/backups">' + BACKUPS + '</Config><Config Target="3000">3100</Config>'
    return ('<Container version="2"><Name>notebook</Name><Repository>' + OLD + '</Repository><Network>notebook-net</Network><Privileged>false</Privileged><ExtraParams>preserve-exactly</ExtraParams>' + configs + '</Container>').encode()


class ValidationTests(unittest.TestCase):
    def test_digest_rejects_floating_tags_other_repository_and_injection(self):
        for value in ["ghcr.io/imnoname25/notebook:latest", "other@sha256:" + "a" * 64, NEW + ";bad", None]:
            with self.assertRaises(ValueError):
                digest(value)

    def test_manifest_rejects_non_release_and_unsafe_migration_names(self):
        value = {"format": 1, "repository": "imnoname25/notebook", "image": NEW, "sha": "a" * 40, "version": "0.6.0", "ref": "refs/tags/v0.6.0", "migrations": []}
        self.assertEqual(manifest(value), value)
        for update in [{"ref": "refs/heads/main"}, {"migrations": [{"name": "../escape", "sha256": "a" * 64}]}]:
            with self.assertRaises(ValueError):
                manifest({**value, **update})

    def test_migrations_must_preserve_old_names_and_checksums(self):
        old = [{"name": "001", "sha256": "a" * 64}]
        self.assertEqual(migration_delta(old, old + [{"name": "002", "sha256": "b" * 64}]), [{"name": "002", "sha256": "b" * 64}])
        for changed in [[], [{"name": "001", "sha256": "b" * 64}]]:
            with self.assertRaises(ValueError):
                migration_delta(old, changed)

    def test_expected_configuration_and_paths_are_enforced(self):
        original = container()
        signature = runtime(original)
        self.assertEqual(len(signature), 64)
        changed = copy.deepcopy(original)
        changed["Mounts"][0]["Source"] = "/mnt/user/appdata/notebook/uploads"
        with self.assertRaises(ValueError):
            runtime(changed)

    def test_secret_drift_is_detected_without_disclosing_values(self):
        original = container()
        changed = copy.deepcopy(original)
        changed["Config"]["Env"][-1] = "SETTINGS_ENCRYPTION_KEY=other-unit-test-key"
        self.assertNotEqual(runtime(original), runtime(changed))
        self.assertNotIn("unit-test", runtime(original))

    def test_recursive_permission_repair_cannot_expose_private_deployment_backups(self):
        info = container()
        info["Config"]["Env"].append("FIX_PERMISSIONS=1")
        with self.assertRaisesRegex(ValueError, "permissions-repair-must-be-disabled"):
            runtime(info)

    def test_template_patch_changes_only_repository_bytes(self):
        info = container()
        original = xml(info)
        template(original, info)
        patched = pinned_template(original, NEW)
        self.assertEqual(patched.replace(NEW.encode(), OLD.encode()), original)
        self.assertEqual(template_fingerprint(original), template_fingerprint(patched))
        self.assertIn(b"preserve-exactly", patched)

    def test_wrong_xml_secret_and_entity_declaration_fail_closed(self):
        info = container()
        for content in [xml(info).replace(b"unit-test-key", b"different"), b'<!DOCTYPE Container [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml(info)]:
            with self.assertRaises(ValueError):
                template(content, info)

    def test_review_requires_matching_backup_and_both_rehearsals(self):
        state = {"previous_image": OLD, "candidate_image": NEW, "dump_sha256": "a" * 64, "uploads_sha256": "b" * 64, "migration_manifest_sha256": "c" * 64}
        valid = {**state, "migration_review_passed": True, "upgrade_rehearsal_passed": True, "rollback_rehearsal_passed": True}
        review(valid, state)
        for update in [{"dump_sha256": "d" * 64}, {"rollback_rehearsal_passed": False}, {"upgrade_rehearsal_passed": "true"}]:
            with self.assertRaises(ValueError):
                review({**valid, **update}, state)

    def test_approval_bound_to_review_and_exact_image_pair(self):
        state = {"previous_image": OLD, "candidate_image": NEW, "migration_manifest_sha256": "c" * 64}
        valid = {"format": 1, "repository": "imnoname25/notebook", "previous_image": OLD, "image": NEW, "manifest_sha256": "c" * 64, "review_sha256": "d" * 64}
        approved_request(valid, state, "d" * 64)
        with self.assertRaises(ValueError):
            approved_request(valid, state, "e" * 64)

    def test_missing_postgres_information_does_not_default_to_template_example(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.json"
            path.write_text('{"managed_verification": true}', encoding="utf-8")
            with self.assertRaises(ValueError):
                deploy.config(path)

    def test_database_failure_never_prints_docker_stderr(self):
        from types import SimpleNamespace
        with patch.object(deploy.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout=b"")) as mocked:
            with self.assertRaisesRegex(ValueError, "local-command-failed"):
                deploy.run(["docker", "exec", "fixture", "pg_restore"])
            self.assertEqual(mocked.call_args.kwargs["stderr"], deploy.subprocess.DEVNULL)

    def test_verification_rejects_production_network_before_restore(self):
        settings = {"postgres_container": "production", "verification_container": "scratch"}
        production = {"Mounts": []}
        scratch = {"HostConfig": {"NetworkMode": "notebook-net"}}
        with patch.object(deploy, "inspect", side_effect=[production, scratch]), patch.object(deploy, "sql") as query:
            with self.assertRaisesRegex(ValueError, "verification-network"):
                deploy.isolated_verification(settings)
            query.assert_not_called()

    def test_verification_rejects_nested_production_storage(self):
        settings = {"postgres_container": "production", "verification_container": "scratch"}
        production = {"Mounts": [{"Source": "/production/database"}]}
        scratch = {"HostConfig": {"NetworkMode": "none"}, "Mounts": [{"Source": "/production/database/nested"}]}
        with patch.object(deploy, "inspect", side_effect=[production, scratch]):
            with self.assertRaisesRegex(ValueError, "shares-production-storage"):
                deploy.isolated_verification(settings)

    def test_nonempty_verification_database_is_never_restored_over(self):
        settings = {"postgres_container": "production", "verification_container": "scratch", "postgres_major": 17}
        production = {"Mounts": []}
        scratch = {"HostConfig": {"NetworkMode": "none"}, "Mounts": []}
        with patch.object(deploy, "inspect", side_effect=[production, scratch]), patch.object(deploy, "sql", side_effect=["170000", "170000", "1"]):
            with self.assertRaisesRegex(ValueError, "not-empty"):
                deploy.isolated_verification(settings)

    def test_stopped_identity_does_not_persist_health_output(self):
        info = container()
        info["State"]["Health"] = {"Log": [{"Output": "unit-test-private-value"}]}
        self.assertNotIn("unit-test-private-value", json.dumps(deploy.stopped_identity(info)))

    def test_backup_source_must_match_existing_database_url(self):
        settings = {"postgres_container": "actual-postgres", "database": "actual_db"}
        production = {"NetworkSettings": {"Networks": {"notebook-net": {"Aliases": ["actual-postgres"]}}}}
        info = container()
        info["Config"]["Env"] = ["DATABASE_URL=postgresql://example:unit-test-value@actual-postgres:5432/actual_db?schema=public"]
        with patch.object(deploy, "inspect", return_value=info), patch.object(deploy, "sql", return_value="5432"):
            deploy.backup_target(settings, production)
            with self.assertRaisesRegex(ValueError, "does-not-match-backup-target"):
                deploy.backup_target({**settings, "database": "other_db"}, production)

    def test_receipt_writer_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            deploy.save(path, {"safe": True})
            with self.assertRaises(FileExistsError):
                deploy.save(path, {"safe": False})

    def test_failed_dump_or_restore_never_authorizes_or_updates_container(self):
        from types import SimpleNamespace
        old_migrations = [{"name": "001", "sha256": "a" * 64}]
        candidate = {"format": 1, "repository": "imnoname25/notebook", "image": NEW, "sha": "a" * 40, "version": "0.6.0", "ref": "refs/tags/v0.6.0", "migrations": old_migrations}
        for fail_stage in ("pg_dump", "pg_restore"):
            with self.subTest(stage=fail_stage), tempfile.TemporaryDirectory() as root:
                base = Path(root)
                (base / "uploads").mkdir()
                (base / "backup").mkdir()
                manifest_path = base / "image.json"
                manifest_path.write_text(json.dumps(candidate), encoding="utf-8")
                info = container()
                commands = []

                def fake_run(command, stdin=None, stdout=None):
                    commands.append(command)
                    if fail_stage in command and "--list" not in command:
                        raise ValueError("local-command-failed")
                    if "pg_dump" in command:
                        stdout.write(b"fake-dump-data")
                    return b""

                def make_private(directory):
                    directory.mkdir(mode=0o700, parents=True, exist_ok=True)

                with patch.object(deploy, "BACKUPS", str(base / "backup")), patch.object(deploy, "UPLOADS", str(base / "uploads")), patch.object(deploy, "current", return_value=(info, xml(info), runtime(info))), patch.object(deploy, "inspect", return_value={"RepoDigests": [OLD]}), patch.object(deploy, "isolated_verification"), patch.object(deploy, "migration_files", return_value=old_migrations), patch.object(deploy, "private_dir", side_effect=make_private), patch.object(deploy, "sql", side_effect=["001:" + "a" * 64, "0", "0"]), patch.object(deploy, "run", side_effect=fake_run):
                    with self.assertRaisesRegex(ValueError, "local-command-failed"):
                        deploy.prepare({"postgres_container": "prod", "postgres_socket": "/socket", "database_user": "role", "database": "db", "verification_container": "scratch", "verification_socket": "/socket", "verification_user": "role", "verification_database": "db"}, SimpleNamespace(manifest=str(manifest_path), previous_image=OLD, exclusive_maintenance=True))
                self.assertFalse(list((base / "backup").rglob("state.json")))
                self.assertFalse(list((base / "backup").rglob("approved.json")))
                self.assertFalse(any(token in command for command in commands for token in ("rm", "run", "create", "start", "restart", "stop")))

    def test_migration_archive_links_are_not_followed(self):
        import tarfile
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w") as tar:
            link = tarfile.TarInfo("migrations/001/migration.sql")
            link.type = tarfile.SYMTYPE
            link.linkname = "/etc/passwd"
            tar.addfile(link)
        with patch.object(deploy, "run", return_value=archive.getvalue()), self.assertRaisesRegex(ValueError, "unsafe-migration-archive"):
            deploy.migration_files()

    def test_expired_approval_cannot_be_reused_for_late_apply_or_rollback(self):
        import datetime as dt
        state = {"previous_image": OLD, "candidate_image": NEW, "dump_sha256": "a" * 64, "uploads_sha256": "b" * 64, "migration_manifest_sha256": "c" * 64, "prepared_at": dt.datetime.now(dt.timezone.utc).isoformat()}
        reviewed = {**state, "migration_review_passed": True, "upgrade_rehearsal_passed": True, "rollback_rehearsal_passed": True}
        raw = json.dumps(reviewed).encode()
        receipt = {"format": 1, "repository": "imnoname25/notebook", "previous_image": OLD, "image": NEW, "manifest_sha256": "c" * 64, "review_sha256": hash_bytes(raw), "issued_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat()}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            deploy.save(path / "review.json", raw)
            deploy.save(path / "approved.json", receipt)
            with self.assertRaisesRegex(ValueError, "approval-expired"):
                deploy.fresh_approval(path, state)


class ApprovalTests(unittest.TestCase):
    def test_environment_must_have_individual_reviewers(self):
        client = approval.GitHub()
        good = {"id": 1, "protection_rules": [{"type": "required_reviewers", "reviewers": [{"type": "User", "reviewer": {"id": 7}}]}]}
        with patch.object(client, "api", return_value=good):
            client.protection()
        for value in [{}, {**good, "protection_rules": []}]:
            with patch.object(client, "api", return_value=value), self.assertRaises(ValueError):
                client.protection()

    def test_manual_review_must_match_environment_and_listed_reviewer(self):
        client = approval.GitHub()
        for history in [[], [{"state": "approved", "user": {"id": 99}, "environments": [{"id": 1}]}], [{"state": "approved", "user": {"id": 7}, "environments": [{"id": 2}]}]]:
            with patch.object(client, "protection", return_value=(1, [7])), patch.object(client, "api", return_value=history), self.assertRaises(ValueError):
                client.manual_approval("123")
        with patch.object(client, "protection", return_value=(1, [7])), patch.object(client, "api", return_value=[{"state": "approved", "user": {"id": 7}, "environments": [{"id": 1}]}]):
            client.manual_approval("123")

    def test_successful_unrelated_workflow_is_not_an_approval(self):
        client = approval.GitHub()
        value = {"repository": {"full_name": "imnoname25/notebook"}, "path": ".github/workflows/other.yml", "status": "completed", "conclusion": "success"}
        with patch.object(client, "api", return_value=value), self.assertRaises(ValueError):
            client.run("123", "unraid-production-approval.yml", "main")

    def test_artifact_tampering_and_traversal_entries_are_rejected(self):
        for name, tamper in [("../approved-request.json", False), ("approved-request.json", True)]:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr(name, "{}")
            raw = archive.getvalue()
            entry = {"id": 1, "name": "approved-unraid-update", "expired": False, "size_in_bytes": len(raw), "digest": "sha256:" + ("a" * 64 if tamper else hash_bytes(raw))}
            client = approval.GitHub()
            with patch.object(client, "api", return_value={"artifacts": [entry]}), patch.object(client, "request", return_value=io.BytesIO(raw)), self.assertRaises(ValueError):
                client.artifact("123", "approved-unraid-update", "approved-request.json")


if __name__ == "__main__":
    unittest.main()
