#!/usr/bin/env python3
"""Check root Compose wiring with synthetic secrets, without a Docker Engine."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-command", default="docker compose")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    compose = shlex.split(args.compose_command)
    require(bool(compose), "Compose command must not be empty")
    # A service env_file/include could read real secrets independently of --env-file.
    for file in ("compose.yml", "compose.gpu.yml"):
        require(not re.search(r"^\s*(env_file|include|extends)\s*:",
                              (root / file).read_text(), re.MULTILINE),
                "Use explicit service environments; env_file/include/extends are outside this check")
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "SYSTEMROOT", "TMPDIR")
                   if key in os.environ}
    environment.update({
        "DB_URL": "jdbc:mysql://host-must-not-leak:3306/wrong",
        "PG_DASHBOARD_URL": "http://host-must-not-leak:9999",
        "PG_MODEL_API": "ollama",
        "PG_MODEL_BASE_URL": "http://host-must-not-leak:11434",
        "PG_MODEL_NAME": "host-must-not-leak",
        "SPRING_FLYWAY_LOCATIONS": "filesystem:/host-must-not-leak",
        "UNRELATED_SECRET": "synthetic-must-not-leak",
        "GUARD_SERVER_URL": "http://host-must-not-leak:7777",
        "GUARD_ADMIN_KEY": "synthetic-wrong-admin-key",
    })
    credentials = {"MYSQL_ROOT_PASSWORD": "synthetic-root-password",
                   "DB_PASSWORD": "synthetic-db-password",
                   "PG_API_KEYS": "synthetic-api-key",
                   "PG_ADMIN_KEYS": "synthetic-admin-key"}

    with tempfile.TemporaryDirectory(prefix="safeprompt-compose-") as temporary:
        env_file = Path(temporary) / "check.env"

        def config(values, *, template="", gpu=False, valid=True):
            env_file.write_text(template + "\n" + "\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
            files = ["-f", str(root / "compose.yml")]
            if gpu:
                files += ["-f", str(root / "compose.gpu.yml")]
            result = subprocess.run(
                compose + ["--env-file", str(env_file)] + files + ["config", "--format", "json"],
                cwd=root, env=environment, capture_output=True, text=True, check=False)
            require((result.returncode == 0) == valid,
                    "Compose config unexpectedly " + ("failed" if valid else "accepted missing credentials"))
            return json.loads(result.stdout) if valid else None

        base = config(credentials)
        custom = config({**credentials, "APP_BIND_IP": "192.0.2.20", "APP_PORT": "18080",
                         "PG_BIND_IP": "192.0.2.21", "PG_PORT": "18000",
                         "DB_USERNAME": "synthetic-user", "PG_MODEL_MODE": "optional",
                         "PG_MODEL_TIMEOUT_S": "150", "DECIDER_THREADS": "6",
                         "DECIDER_OFFLINE": "true", "DECIDER_GPU_LAYERS": "8"})
        example = config(credentials, template=(root / ".env.example").read_text())
        gpu = config(credentials, gpu=True)
        gpu_custom = config({**credentials, "DECIDER_GPU_LAYERS": "8"}, gpu=True)
        multiple_admin = config({**credentials, "PG_ADMIN_KEYS": "synthetic-first,synthetic-second"})
        without_admin = config({k: v for k, v in credentials.items() if k != "PG_ADMIN_KEYS"})
        for key in ("MYSQL_ROOT_PASSWORD", "PG_API_KEYS"):
            config({k: v for k, v in credentials.items() if k != key}, valid=False)

    for cfg in (base, custom, example, gpu, gpu_custom):
        services = cfg["services"]
        require(set(services) == {"dashboard", "mysql", "server", "decider-pull", "decider"}, "Expected app, DB and Decider services")
        require(set(cfg["volumes"]) == {"mysql-data", "server-data", "decider-data"}, "Unexpected data volumes")
        dashboard, mysql, server = (services[name] for name in ("dashboard", "mysql", "server"))
        for name in ("dashboard", "server"):
            service = services[name]
            require(Path(service["build"]["context"]) == root / name, f"Wrong {name} build context")
            require(service["build"]["dockerfile"] == "Dockerfile", f"Wrong {name} Dockerfile")
            require(service.get("pull_policy") == "build", f"{name} must rebuild current source")
        require(dashboard["depends_on"]["mysql"]["condition"] == "service_healthy", "Dashboard must wait for MySQL")
        require(server["depends_on"]["dashboard"]["condition"] == "service_healthy", "Server must wait for dashboard")
        require(server["depends_on"]["decider"]["condition"] == "service_healthy", "Server must wait for model")
        for name, endpoint in (("mysql", "mysqladmin ping"), ("dashboard", "/api/v1/health"),
                               ("server", "/healthz"), ("decider", "/health")):
            require(endpoint in " ".join(services[name]["healthcheck"]["test"]), f"Missing {name} health check")
        db_env, mysql_env, pg_env = (services[name]["environment"] for name in ("dashboard", "mysql", "server"))
        require(db_env["DB_URL"] == "jdbc:mysql://mysql:3306/ai_security_dashboard?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true", "DB URL must use internal MySQL")
        require(pg_env["PG_DASHBOARD_URL"] == "http://dashboard:8080", "Dashboard URL must use internal service")
        require(pg_env["PG_MODEL_API"] == "decider" and pg_env["PG_MODEL_BASE_URL"] == "http://decider:8000"
                and pg_env["PG_MODEL_NAME"] == "Mapika/decider-4b" and not pg_env["PG_MODEL_API_KEY"],
                "Model must use internal Decider typed-decision API")
        require(set(db_env) == {"DB_URL", "DB_USERNAME", "DB_PASSWORD", "SERVER_ADDRESS", "SERVER_PORT", "GUARD_SERVER_URL", "GUARD_ADMIN_KEY"}, "Unexpected dashboard environment")
        require(db_env["GUARD_SERVER_URL"] == "http://server:8000", "Guard URL must use internal service")
        require(db_env["GUARD_ADMIN_KEY"] == pg_env["PG_ADMIN_KEYS"], "Guard must share generated admin keys")
        require("server" not in dashboard["depends_on"], "Dashboard must connect lazily without a dependency cycle")
        require(set(mysql_env) == {"MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD", "TZ"}, "Unexpected MySQL environment")
        require(all(key.startswith("PG_") for key in pg_env), "Only PG_* settings belong in server")
        require(mysql_env["MYSQL_PASSWORD"] == db_env["DB_PASSWORD"] == credentials["DB_PASSWORD"], "DB credentials disagree")
        require(mysql_env["MYSQL_USER"] == db_env["DB_USERNAME"], "DB users disagree")
        require(pg_env["PG_API_KEYS"] == credentials["PG_API_KEYS"] and pg_env["PG_ADMIN_KEYS"] == credentials["PG_ADMIN_KEYS"], "Server keys missing")
        require(str(pg_env["PG_AUTH_DISABLED"]).lower() == "false", "Authentication must default to enabled")
        require(not mysql.get("ports"), "MySQL must not publish a host port")
        require(len(mysql["volumes"]) == 1 and mysql["volumes"][0]["source"] == "mysql-data"
                and mysql["volumes"][0]["target"] == "/var/lib/mysql", "MySQL data must persist")
        mounts = {mount["target"]: mount for mount in server["volumes"]}
        require(set(mounts) == {"/srv/data", "/srv/policies"}, "Unexpected server mounts")
        require(mounts["/srv/data"]["source"] == "server-data", "Server data must persist")
        require(Path(mounts["/srv/policies"]["source"]) == root / "server/policies"
                and mounts["/srv/policies"]["read_only"], "Policy mount must be read-only")
        require(not dashboard.get("volumes"), "Dashboard must not mount development seed SQL")
        require(pg_env["PG_POLICY_PATH"] == "/srv/policies/default.yaml", "Policy path must match mount")
        for key, filename in (("PG_AUDIT_DB_PATH", "audit"), ("PG_CLIENTS_DB_PATH", "clients"),
                              ("PG_RULESET_DB_PATH", "ruleset"), ("PG_ORG_DB_PATH", "org")):
            require(pg_env[key] == f"/srv/data/{filename}.sqlite3", f"{key} must use persistent storage")
        puller, decider = services["decider-pull"], services["decider"]
        require(decider["depends_on"]["decider-pull"]["condition"] == "service_completed_successfully", "Model must wait for verified download")
        require(cfg["networks"]["decider-internal"]["internal"], "Inference network must be internal")
        require(set(decider["networks"]) == {"decider-internal"}, "Model inference must have only internal network")
        require(not set(puller["networks"]) & set(server["networks"]), "Downloader must not share server network")
        require(set(server["networks"]) == {"default", "decider-internal"}, "Server must reach dashboard and model")
        for name in ("decider-pull", "decider"):
            service = services[name]
            require(Path(service["build"]["context"]) == root / "server/decider"
                    and service["build"]["dockerfile"] == "Dockerfile", f"Wrong {name} build")
            require(not service.get("ports") and not service.get("profiles"), f"{name} must start without host ports or profiles")
            require(len(service["volumes"]) == 1 and service["volumes"][0]["source"] == "decider-data"
                    and service["volumes"][0]["target"] == "/models", f"{name} must share model cache")
        require(puller["build"]["target"] == "downloader" and puller["restart"] == "no", "Downloader must be a one-shot build target")
        require(set(puller["environment"]) == {"DECIDER_OFFLINE"}, "Downloader must not receive app secrets")
        require(decider["volumes"][0]["read_only"], "Inference must read model cache without modifying it")
        require(all(not key.startswith(("PG_", "DB_", "MYSQL_")) for key in decider["environment"]), "Model must not receive app secrets")
        require(decider["environment"]["HF_HUB_OFFLINE"] == "1"
                and decider["environment"]["TRANSFORMERS_OFFLINE"] == "1", "Inference must load offline")

    for cfg, host_ips, ports in ((base, ("0.0.0.0", "0.0.0.0"), ("8080", "8000")),
                                 (example, ("0.0.0.0", "0.0.0.0"), ("8080", "8000")),
                                 (custom, ("192.0.2.20", "192.0.2.21"), ("18080", "18000"))):
        for name, host_ip, published, target in zip(("dashboard", "server"), host_ips, ports, (8080, 8000)):
            bindings = cfg["services"][name]["ports"]
            require(len(bindings) == 1 and bindings[0]["host_ip"] == host_ip
                    and bindings[0]["published"] == published and bindings[0]["target"] == target,
                    f"Wrong {name} published port")
    for cfg in (base, example):
        require(cfg["services"]["server"]["environment"]["PG_MODEL_MODE"] == "required"
                and cfg["services"]["server"]["environment"]["PG_MODEL_TIMEOUT_S"] == "120", "Default model must be required with 120s timeout")
    for cfg in (base, custom, example):
        decider = cfg["services"]["decider"]
        require(decider["build"]["target"] == "cpu" and not decider.get("gpus")
                and decider["environment"]["DECIDER_GPU_LAYERS"] == "0", "Base must use CPU regardless of GPU env")
    for cfg, layers in ((gpu, "-1"), (gpu_custom, "8")):
        decider = cfg["services"]["decider"]
        require(decider["build"]["target"] == "cuda"
                and decider["environment"]["DECIDER_GPU_LAYERS"] == layers, "GPU override must select CUDA and requested layers")
        # Compose normalizes `gpus: all` to count=-1; gpu capability is implicit.
        require(len(decider["gpus"]) == 1 and decider["gpus"][0]["count"] == -1,
                "GPU override must request host GPU access")
    require(custom["services"]["server"]["environment"]["PG_MODEL_MODE"] == "optional"
            and custom["services"]["server"]["environment"]["PG_MODEL_TIMEOUT_S"] == "150"
            and custom["services"]["decider"]["environment"]["DECIDER_THREADS"] == "6"
            and custom["services"]["decider-pull"]["environment"]["DECIDER_OFFLINE"] == "true", "Model runtime settings must be configurable")
    require(multiple_admin["services"]["dashboard"]["environment"]["GUARD_ADMIN_KEY"] == "synthetic-first,synthetic-second",
            "Dashboard must receive all keys for backend first-key selection")
    require(without_admin["services"]["dashboard"]["environment"]["GUARD_ADMIN_KEY"] == "", "Missing admin key must stay empty")
    require(without_admin["services"]["server"]["environment"]["PG_ADMIN_KEYS"] == "", "Admin key must remain optional")
    require(subprocess.run(["git", "check-ignore", "--quiet", ".env"], cwd=root,
                           env=environment, check=False).returncode == 0, "Root .env must be gitignored")
    print("PASS: root Compose defaults/example/overrides, CPU/CUDA overlay, isolated model download/inference, scoped environments, internal URLs, health dependencies, private MySQL, persistent volumes, required secrets, and ignored .env")
    print("Scope: Compose config parsing only; no images built or containers executed. Real .env was not read.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        raise SystemExit(f"FAIL: {error}") from None
