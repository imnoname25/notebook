"""Destructive paths use an in-memory Engine only. Never connects to Docker, SSH or production."""
import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import deploy
import engine
import executor
import gateway
from deploy_core import hash_bytes, runtime
from test_deployment import NEW, OLD, container, xml


class MemoryEngine:
    def __init__(self):
        info = container()
        info["State"]["Running"] = True
        info["State"]["Health"] = {"Status": "healthy"}
        info["HostConfig"].update(RestartPolicy={"Name": "unless-stopped", "MaximumRetryCount": 0}, Memory=1048576000, CapDrop=["ALL"], SecurityOpt=["no-new-privileges:true"])
        info["Config"].update(Labels={"custom": "preserved"}, User="99:100", Hostname="existing-hostname", Healthcheck={"Test": ["CMD", "health"]})
        info["NetworkSettings"]["Networks"]["notebook-net"] = {"IPAMConfig": {"IPv4Address": "172.25.0.10"}, "Aliases": ["notebook", "custom-alias"]}
        self.original = copy.deepcopy(info)
        self.containers = {"notebook": info}
        self.events = []
        self.drift = False

    def inspect(self, name):
        return copy.deepcopy(self.containers[name])

    def image(self, _):
        return {"RepoDigests": [OLD, NEW], "Config": {"Labels": {"org.opencontainers.image.revision": "a" * 40}}}

    def stop(self, name):
        self.events.append(("stop", name))
        self.containers[name]["State"]["Running"] = False

    def start(self, name):
        self.events.append(("start", name))
        self.containers[name]["State"]["Running"] = True

    def rename(self, name, target):
        self.events.append(("rename", name, target))
        self.containers[target] = self.containers.pop(name)
        self.containers[target]["Name"] = "/" + target

    def disable_restart(self, name):
        self.events.append(("disable_restart", name))
        self.containers[name]["HostConfig"]["RestartPolicy"] = {"Name": "no"}

    def disconnect(self, name):
        self.events.append(("disconnect", name))
        self.containers[name]["NetworkSettings"]["Networks"] = {}

    def create(self, name, spec):
        self.events.append(("create", name, spec["Image"]))
        value = copy.deepcopy(self.original)
        value["Config"] = {k: copy.deepcopy(v) for k, v in spec.items() if k not in ("HostConfig", "NetworkingConfig")}
        value["HostConfig"] = copy.deepcopy(spec["HostConfig"])
        value["State"]["Running"] = False
        if self.drift and spec["Image"] == NEW:
            value["HostConfig"]["Memory"] = 2
        self.containers[name] = value


class ExecutionTests(unittest.TestCase):
    def transaction(self, *, backup_error=False, health_error=False, schema_changed=False, drift=False, rollback=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        directory = base / ("a" * 32)
        fresh = base / ("b" * 32)
        directory.mkdir(mode=0o700)
        fresh.mkdir(mode=0o700)
        fake = MemoryEngine()
        fake.drift = drift
        if rollback:
            fake.containers["notebook"]["Config"]["Image"] = NEW
        original_xml = xml(fake.original)
        current_xml = [original_xml.replace(OLD.encode(), NEW.encode()) if rollback else original_xml]
        state = {"previous_image": OLD, "candidate_image": NEW, "runtime_fingerprint": runtime(fake.original), "database_history": ["001:checksum"]}
        deploy.save(directory / "original.xml", original_xml)
        deploy.save(directory / "image.json", {"sha": "a" * 40})
        def current(_):
            info = fake.inspect("notebook")
            return info, current_xml[0], runtime(info)
        def install(_, expected, replacement):
            self.assertEqual(current_xml[0], expected)
            current_xml[0] = replacement
        def healthy(_, image, *args):
            if health_error and image == NEW:
                raise ValueError("health-timeout")
        patches = [patch.object(executor, "Engine", return_value=fake), patch.object(deploy, "current", side_effect=current), patch.object(deploy, "run"), patch.object(executor, "postgres_guard", return_value="unchanged"), patch.object(executor, "snapshot", side_effect=ValueError("backup-failed") if backup_error else None, return_value=fresh.name), patch.object(deploy, "load_state", return_value=(fresh, state)), patch.object(executor, "install_template", side_effect=install), patch.object(executor, "healthy", side_effect=healthy), patch.object(executor, "history", return_value=["002:new"] if schema_changed else state["database_history"])]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        item = patch.object(executor, "capacity")
        item.start()
        self.addCleanup(item.stop)
        request = {"operation": "rollback" if rollback else "deploy", "approval_run_id": "123"}
        expected_error = backup_error or health_error or drift or (rollback and schema_changed)
        if expected_error:
            with self.assertRaises(ValueError):
                executor.execute({"execution_enabled": True}, directory, state, request)
        else:
            executor.execute({"execution_enabled": True}, directory, state, request)
        self.assertFalse(any("notebook-postgres" in event for event in fake.events))
        return fake, fresh

    def test_success_preserves_settings_secrets_network_ports_and_keeps_old_container(self):
        fake, fresh = self.transaction()
        self.assertEqual(runtime(fake.inspect("notebook")), runtime(fake.original))
        retained = fake.inspect("notebook-retained-" + fresh.name)
        self.assertFalse(retained["State"]["Running"])
        self.assertEqual(retained["HostConfig"]["RestartPolicy"]["Name"], "no")
        self.assertTrue((fresh / "success.json").is_file())

    def test_failed_backup_resumes_original_and_never_creates_or_renames(self):
        fake, _ = self.transaction(backup_error=True)
        self.assertEqual([e[0] for e in fake.events], ["stop", "start"])
        self.assertEqual(fake.inspect("notebook")["Config"]["Image"], OLD)

    def test_failed_health_with_unchanged_schema_recovers_previous_digest(self):
        fake, fresh = self.transaction(health_error=True)
        self.assertEqual(fake.inspect("notebook")["Config"]["Image"], OLD)
        self.assertTrue((fresh / "automatic-rollback.json").is_file())
        self.assertIn("notebook-failed-" + fresh.name, fake.containers)

    def test_failed_health_after_migration_never_starts_previous_image(self):
        fake, fresh = self.transaction(health_error=True, schema_changed=True)
        self.assertNotIn("notebook", fake.containers)
        self.assertFalse((fresh / "automatic-rollback.json").exists())
        self.assertFalse(fake.inspect("notebook-failed-" + fresh.name)["State"]["Running"])

    def test_create_setting_drift_is_caught_before_new_image_start(self):
        fake, _ = self.transaction(drift=True)
        first_create = next(i for i, e in enumerate(fake.events) if e[0] == "create")
        next_rename = next(i for i, e in enumerate(fake.events[first_create + 1:], first_create + 1) if e[0] == "rename")
        self.assertFalse(any(e == ("start", "notebook") for e in fake.events[first_create:next_rename]))
        self.assertEqual(fake.inspect("notebook")["Config"]["Image"], OLD)

    def test_manual_rollback_gets_fresh_backup_and_preserves_all_settings(self):
        fake, fresh = self.transaction(rollback=True)
        self.assertEqual(fake.inspect("notebook")["Config"]["Image"], OLD)
        self.assertTrue((fresh / "success.json").is_file())

    def test_manual_rollback_with_schema_changes_stops_before_application_stop(self):
        fake, _ = self.transaction(rollback=True, schema_changed=True)
        self.assertEqual(fake.events, [])

    def test_disabled_execution_cannot_touch_docker(self):
        with patch.object(executor, "Engine") as mocked, self.assertRaisesRegex(ValueError, "execution-disabled"):
            executor.execute({"execution_enabled": False}, None, None, {"operation": "deploy"})
        mocked.assert_not_called()


class BoundaryTests(unittest.TestCase):
    def test_verifier_is_isolated_and_cleanup_cannot_target_production(self):
        from unittest.mock import Mock
        import verification
        fake = Mock()
        def inspected(name):
            if name == "notebook-postgres":
                return {"Image": "sha256:" + "f" * 64}
            return {"Config": {"Labels": {"notebook.verifier": name.removeprefix("notebook-verify-")}}}
        fake.inspect.side_effect = inspected
        with tempfile.TemporaryDirectory() as root, patch.object(verification, "BACKUPS", root), patch.object(verification, "Engine", return_value=fake), patch.object(deploy, "private_dir", side_effect=lambda p: p.mkdir(mode=0o700, parents=True, exist_ok=True)), patch.object(deploy, "run", return_value=b"postgres\n"):
            with verification.manager({}) as settings:
                name, spec = fake.create.call_args.args
                self.assertEqual(settings["verification_container"], name)
                self.assertTrue(name.startswith("notebook-verify-"))
                self.assertEqual(spec["HostConfig"]["NetworkMode"], "none")
                self.assertFalse(spec["HostConfig"]["Privileged"])
                self.assertNotIn("PortBindings", spec["HostConfig"])
                self.assertEqual(spec["Image"], "sha256:" + "f" * 64)
                self.assertNotIn("DATABASE_URL", str(spec))
                self.assertNotIn("SETTINGS_ENCRYPTION_KEY", str(spec))
                self.assertTrue(spec["HostConfig"]["Binds"][0].startswith(root))
            fake.stop.assert_called_once_with(name)
            fake.remove_verifier.assert_called_once_with(name, name.removeprefix("notebook-verify-"))
            self.assertTrue(Path(settings["_managed_verification_source"]).is_dir())

    def test_capacity_failure_never_prunes_existing_data(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as root, patch.object(executor, "UPLOADS", root), patch.object(deploy, "sql", return_value="1000"), patch.object(executor.shutil, "disk_usage", return_value=SimpleNamespace(free=1)), self.assertRaisesRegex(ValueError, "insufficient-backup-space"):
            executor.capacity({})

    def test_unresolved_migration_prevents_reading_history_for_rollback(self):
        with patch.object(deploy, "sql", return_value="1") as sql, self.assertRaisesRegex(ValueError, "unresolved-migration"):
            executor.history({})
        self.assertEqual(sql.call_count, 1)

    def test_delivery_accepts_only_successful_approve_job_in_current_attempt(self):
        import approval
        client = approval.GitHub()
        run = {"repository": {"full_name": "imnoname25/notebook"}, "path": ".github/workflows/unraid-production-approval.yml", "head_branch": "main", "status": "in_progress", "conclusion": None, "run_attempt": 2}
        for jobs, allowed in [([], False), ([{"name": "approve", "conclusion": "failure"}], False), ([{"name": "approve", "conclusion": "success"}], True)]:
            with patch.object(client, "api", side_effect=[run, {"jobs": jobs}]) as api:
                if allowed:
                    client.run("123", "unraid-production-approval.yml", "main", delivering=True)
                else:
                    with self.assertRaises(ValueError):
                        client.run("123", "unraid-production-approval.yml", "main", delivering=True)
                self.assertIn("/attempts/2/jobs", api.call_args.args[0])

    def test_forced_command_denies_shell_flags_newlines_and_extra_arguments(self):
        self.assertEqual(gateway.command("dispatch 123"), "123")
        for value in [None, "dispatch 0", "dispatch 123;id", "dispatch 123\nid", "dispatch 123 extra", "bash", "dispatch $(id)"]:
            with self.assertRaises(ValueError):
                gateway.command(value)

    def test_engine_prohibits_production_postgres_mutation_and_app_deletion(self):
        client = engine.Engine.__new__(engine.Engine)
        with patch.object(client, "inspect") as mocked:
            for name in ["notebook-postgres", "arbitrary"]:
                with self.assertRaises(ValueError):
                    client.stop(name)
            with self.assertRaises(ValueError):
                client.create("notebook-postgres", {})
            mocked.assert_not_called()
        info = container()
        with patch.object(client, "owned", return_value=info), self.assertRaises(ValueError):
            client.remove_verifier("notebook", "a" * 32)

    def test_generated_network_ids_do_not_hide_user_alias_or_static_ip_changes(self):
        a = container()
        a["NetworkSettings"]["Networks"]["notebook-net"] = {"Aliases": ["custom", a["Id"]]}
        b = copy.deepcopy(a)
        b["Id"] = "other-container-id"
        b["NetworkSettings"]["Networks"]["notebook-net"]["Aliases"] = ["custom", b["Id"]]
        self.assertEqual(runtime(a), runtime(b))
        b["NetworkSettings"]["Networks"]["notebook-net"]["Aliases"][0] = "different"
        self.assertNotEqual(runtime(a), runtime(b))

    def test_control_pins_require_exact_reviewed_workflow_and_code(self):
        from unittest.mock import Mock
        client = Mock()
        client.run.return_value = {"head_sha": "a" * 40}
        client.api.return_value = {"encoding": "base64", "content": "eA=="}
        pins = {name: hash_bytes(b"x") for name in gateway.PINNED}
        gateway.verify_control(client, {"trusted_control_hashes": pins}, "123", {"control_sha": "a" * 40})
        for settings in [{}, {"trusted_control_hashes": {**pins, gateway.PINNED[0]: "b" * 64}}]:
            with self.assertRaises(ValueError):
                gateway.verify_control(client, settings, "123", {"control_sha": "a" * 40})

    def test_approval_is_consumed_once_even_if_execution_fails(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            state = {"previous_image": OLD, "candidate_image": NEW, "dump_sha256": "a" * 64, "uploads_sha256": "b" * 64, "migration_manifest_sha256": "c" * 64, "prepared_at": now}
            reviewed = json.dumps({**state, "migration_review_passed": True, "upgrade_rehearsal_passed": True, "rollback_rehearsal_passed": True}).encode()
            deploy.save(base / "review.json", reviewed)
            request = {"format": 1, "repository": "imnoname25/notebook", "previous_image": OLD, "image": NEW, "manifest_sha256": "c" * 64, "review_sha256": hash_bytes(reviewed), "operation": "deploy", "preparation_id": "a" * 32}
            settings = {"execution_enabled": True, "approval_mode": "required-reviewers", "github_token_file": str(base / "github-token")}
            with patch.object(gateway, "CONTROL", base), patch.object(gateway, "private_file", return_value=b"test-only"), patch.object(gateway, "approved", return_value=request), patch.object(gateway, "verify_control"), patch.object(deploy, "load_state", return_value=(base, state)), patch.object(deploy, "private_dir", side_effect=lambda p: p.mkdir(mode=0o700, exist_ok=True)), patch.object(executor, "execute", side_effect=ValueError("failed")) as execute:
                with self.assertRaisesRegex(ValueError, "failed"):
                    gateway.dispatch(settings, "123")
                with self.assertRaises(FileExistsError):
                    gateway.dispatch(settings, "123")
                self.assertEqual(execute.call_count, 1)


if __name__ == "__main__":
    unittest.main()
