#!/usr/bin/env python3
"""Build and fail-closed validate the sanitized Notifications N0 evidence artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALLOWED_FILES = {
    ".github/workflows/notifications-n0-dev-readonly-evidence.yml",
    "ops/notifications/n0-readonly-evidence/audit.sql",
    "ops/notifications/n0-readonly-evidence/validate_artifact.py",
    "ops/notifications/n0-readonly-evidence/README.md",
}
ROOT_KEYS = {
    "schema_version", "generated_at_utc", "github_head_sha", "environment",
    "migrations", "database", "notification_aggregates", "intake_aggregates",
    "payment_receipt_aggregates", "storage_metadata", "dispatcher", "n8n",
    "send_mode", "source_status", "privacy_validation", "cleanup_status",
}
SENSITIVE_ENV_NAMES = (
    "SUPABASE_DEV_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DEV_PROJECT_REF",
    "N8N_DEV_API_URL", "N8N_DEV_API_KEY",
)
SAFE_NAME = re.compile(r"^[A-Za-z0-9_. -]{1,160}$")
SAFE_SIGNATURE = re.compile(r"^[A-Za-z0-9_ .,:()\[\]]{0,300}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEAD_SHA = re.compile(r"^[0-9a-f]{40}$")
FORBIDDEN_VALUE_PATTERNS = (
    re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I),
    re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.I),
    re.compile(r"https?://", re.I),
    re.compile(r"postgres(?:ql)?://", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"(?:token|secret|password|api[_-]?key)\s*[:=]", re.I),
    re.compile(r"(?:X-Amz-Signature|Signature=|sig=)", re.I),
    re.compile(r"(?:recipient|payload|error_message|stack_trace|storage_path|signed_url)\s*[:=]", re.I),
)


class AuditError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def exact_keys(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{label} must be an object")
    require(set(value) == keys, f"{label} keys differ from the allowlist")
    return value


def safe_name(value: Any, label: str, pattern: re.Pattern[str] = SAFE_NAME) -> str:
    require(isinstance(value, str) and pattern.fullmatch(value) is not None, f"unsafe {label}")
    return value


def nullable_count(value: Any, label: str) -> None:
    require(value is None or (isinstance(value, int) and not isinstance(value, bool) and value >= 0), f"invalid {label}")


def count(value: Any, label: str) -> None:
    require(isinstance(value, int) and not isinstance(value, bool) and value >= 0, f"invalid {label}")


def tri_bool(value: Any, label: str) -> None:
    require(value is None or isinstance(value, bool), f"invalid {label}")


def validate_count_rows(rows: Any, dimensions: tuple[str, ...], label: str) -> None:
    require(isinstance(rows, list), f"{label} must be a list")
    expected = set(dimensions) | {"count"}
    for index, row in enumerate(rows):
        row = exact_keys(row, expected, f"{label}[{index}]")
        for dimension in dimensions:
            safe_name(row[dimension], f"{label}.{dimension}")
        count(row["count"], f"{label}.count")


def validate_migrations(value: Any) -> None:
    value = exact_keys(value, {"available", "entries", "duplicates", "required_versions"}, "migrations")
    require(isinstance(value["available"], bool), "migrations.available must be boolean")
    require(isinstance(value["entries"], list), "migrations.entries must be a list")
    for item in value["entries"]:
        item = exact_keys(item, {"version", "name"}, "migration entry")
        safe_name(item["version"], "migration version")
        require(item["name"] is None or SAFE_NAME.fullmatch(item["name"]), "unsafe migration name")
    require(isinstance(value["duplicates"], list), "migrations.duplicates must be a list")
    for item in value["duplicates"]:
        item = exact_keys(item, {"version", "count"}, "migration duplicate")
        safe_name(item["version"], "migration version")
        count(item["count"], "migration duplicate count")
    require(isinstance(value["required_versions"], list), "required_versions must be a list")
    for item in value["required_versions"]:
        item = exact_keys(item, {"version", "present"}, "required migration")
        safe_name(item["version"], "required migration version")
        require(isinstance(item["present"], bool), "required migration present must be boolean")


def validate_database(value: Any) -> None:
    value = exact_keys(value, {"entities", "functions", "enum_types"}, "database")
    require(isinstance(value["entities"], list), "database.entities must be a list")
    for entity in value["entities"]:
        entity = exact_keys(entity, {"name", "exists", "rls_enabled", "columns", "constraints", "indexes", "policies", "grants", "triggers"}, "entity")
        safe_name(entity["name"], "entity name")
        require(isinstance(entity["exists"], bool), "entity.exists must be boolean")
        tri_bool(entity["rls_enabled"], "entity.rls_enabled")
        require(isinstance(entity["columns"], list), "entity.columns must be a list")
        for column in entity["columns"]:
            column = exact_keys(column, {"name", "type", "nullable", "default_present"}, "column")
            safe_name(column["name"], "column name")
            safe_name(column["type"], "column type", SAFE_SIGNATURE)
            require(isinstance(column["nullable"], bool) and isinstance(column["default_present"], bool), "invalid column flags")
        require(isinstance(entity["constraints"], list), "constraints must be a list")
        for constraint in entity["constraints"]:
            constraint = exact_keys(constraint, {"name", "type", "validated"}, "constraint")
            safe_name(constraint["name"], "constraint name")
            require(constraint["type"] in {"primary_key", "foreign_key", "unique", "check", "exclusion", "other"}, "invalid constraint type")
            require(isinstance(constraint["validated"], bool), "constraint.validated must be boolean")
        require(isinstance(entity["indexes"], list), "indexes must be a list")
        for index in entity["indexes"]:
            index = exact_keys(index, {"name", "unique", "primary", "valid"}, "index")
            safe_name(index["name"], "index name")
            require(all(isinstance(index[key], bool) for key in ("unique", "primary", "valid")), "invalid index flags")
        require(isinstance(entity["policies"], list), "policies must be a list")
        for policy in entity["policies"]:
            policy = exact_keys(policy, {"name", "command", "permissive", "roles"}, "policy")
            safe_name(policy["name"], "policy name")
            safe_name(policy["command"], "policy command")
            require(isinstance(policy["permissive"], str) or isinstance(policy["permissive"], bool), "invalid policy mode")
            require(isinstance(policy["roles"], list), "policy roles must be a list")
            for role in policy["roles"]:
                safe_name(role, "policy role")
        require(isinstance(entity["grants"], list), "grants must be a list")
        for grant in entity["grants"]:
            grant = exact_keys(grant, {"grantee", "privilege"}, "grant")
            safe_name(grant["grantee"], "grantee")
            safe_name(grant["privilege"], "privilege")
        require(isinstance(entity["triggers"], list), "triggers must be a list")
        for trigger in entity["triggers"]:
            trigger = exact_keys(trigger, {"name", "enabled", "function_name"}, "trigger")
            safe_name(trigger["name"], "trigger name")
            safe_name(trigger["enabled"], "trigger state")
            safe_name(trigger["function_name"], "trigger function")
    require(isinstance(value["functions"], list), "database.functions must be a list")
    for function in value["functions"]:
        function = exact_keys(function, {"name", "identity_arguments", "security_definer", "volatility"}, "function")
        safe_name(function["name"], "function name")
        safe_name(function["identity_arguments"], "function signature", SAFE_SIGNATURE)
        require(isinstance(function["security_definer"], bool), "invalid function security flag")
        safe_name(function["volatility"], "function volatility")
    require(isinstance(value["enum_types"], list), "enum_types must be a list")
    for enum_type in value["enum_types"]:
        enum_type = exact_keys(enum_type, {"name", "labels"}, "enum type")
        safe_name(enum_type["name"], "enum name")
        require(isinstance(enum_type["labels"], list), "enum labels must be a list")
        for label in enum_type["labels"]:
            safe_name(label, "enum label")


def validate_notification(value: Any) -> None:
    keys = {"available", "total", "by_status", "by_event_type", "by_status_event_type", "recipient_present", "recipient_absent", "processing_total", "max_processing_age_seconds", "failed", "dead_letter", "cancelled", "events_without_attempts", "events_with_multiple_attempts", "attempts_available", "attempts_by_status", "max_attempt_number"}
    value = exact_keys(value, keys, "notification_aggregates")
    require(isinstance(value["available"], bool) and isinstance(value["attempts_available"], bool), "invalid notification availability")
    for key in keys - {"available", "attempts_available", "by_status", "by_event_type", "by_status_event_type", "attempts_by_status"}:
        nullable_count(value[key], f"notification_aggregates.{key}")
    validate_count_rows(value["by_status"], ("status",), "notification by status")
    validate_count_rows(value["by_event_type"], ("event_type",), "notification by event type")
    validate_count_rows(value["by_status_event_type"], ("status", "event_type"), "notification by status and event type")
    validate_count_rows(value["attempts_by_status"], ("status",), "attempts by status")


def validate_intake(value: Any) -> None:
    value = exact_keys(value, {"available", "total", "by_status", "providers"}, "intake_aggregates")
    require(isinstance(value["available"], bool), "invalid intake availability")
    nullable_count(value["total"], "intake total")
    validate_count_rows(value["by_status"], ("status",), "intake by status")
    providers = exact_keys(value["providers"], {"available", "email_column_present", "with_email", "without_email"}, "providers")
    require(isinstance(providers["available"], bool) and isinstance(providers["email_column_present"], bool), "invalid provider availability")
    nullable_count(providers["with_email"], "providers with email")
    nullable_count(providers["without_email"], "providers without email")


def validate_payment_receipt(value: Any) -> None:
    value = exact_keys(value, {"receipt_links", "evidence", "outbox", "payment_requests"}, "payment_receipt_aggregates")
    receipt = exact_keys(value["receipt_links"], {"available", "total", "distinct_requests", "distinct_evidences", "duplicate_requests", "duplicate_evidences"}, "receipt links")
    evidence = exact_keys(value["evidence"], {"available", "total", "shareable", "one_page", "single_operation_attested"}, "evidence")
    outbox = exact_keys(value["outbox"], {"available", "payment_receipt_linked_events"}, "outbox")
    requests = exact_keys(value["payment_requests"], {"available", "by_status"}, "payment requests")
    for section in (receipt, evidence, outbox, requests):
        require(isinstance(section["available"], bool), "invalid payment section availability")
    for key in set(receipt) - {"available"}:
        nullable_count(receipt[key], f"receipt links {key}")
    for key in set(evidence) - {"available"}:
        nullable_count(evidence[key], f"evidence {key}")
    nullable_count(outbox["payment_receipt_linked_events"], "outbox event count")
    validate_count_rows(requests["by_status"], ("status",), "payment requests by status")


def validate_storage(value: Any) -> None:
    value = exact_keys(value, {"available", "bucket_total", "public_bucket_total", "private_bucket_total", "objects_policy_count", "objects_policies"}, "storage_metadata")
    require(isinstance(value["available"], bool), "invalid storage availability")
    for key in ("bucket_total", "public_bucket_total", "private_bucket_total", "objects_policy_count"):
        nullable_count(value[key], f"storage {key}")
    require(isinstance(value["objects_policies"], list), "storage policies must be a list")
    for policy in value["objects_policies"]:
        policy = exact_keys(policy, {"name", "command", "roles"}, "storage policy")
        safe_name(policy["name"], "storage policy name")
        safe_name(policy["command"], "storage policy command")
        require(isinstance(policy["roles"], list), "storage policy roles must be a list")
        for role in policy["roles"]:
            safe_name(role, "storage policy role")


def validate_external(value: dict[str, Any]) -> None:
    dispatcher = exact_keys(value["dispatcher"], {"metadata_available", "deployed", "verify_jwt", "runtime_source_sha256", "github_source_sha256", "match", "method"}, "dispatcher")
    require(dispatcher["method"] == "OFFICIAL_MANAGEMENT_API_GET", "invalid dispatcher method")
    require(isinstance(dispatcher["metadata_available"], bool), "invalid dispatcher availability")
    tri_bool(dispatcher["deployed"], "dispatcher.deployed")
    tri_bool(dispatcher["verify_jwt"], "dispatcher.verify_jwt")
    tri_bool(dispatcher["match"], "dispatcher.match")
    for key in ("runtime_source_sha256", "github_source_sha256"):
        require(dispatcher[key] is None or SHA256.fullmatch(dispatcher[key]), f"invalid dispatcher {key}")
    n8n = exact_keys(value["n8n"], {"reachable", "relevant_workflow_found", "active", "manual_trigger_only", "scheduled_trigger_present", "can_claim_notification_events", "can_send_email", "last_execution_available", "error_code", "method"}, "n8n")
    require(n8n["method"] == "API_GET_METADATA_ONLY", "invalid n8n method")
    require(isinstance(n8n["reachable"], bool) and isinstance(n8n["relevant_workflow_found"], bool) and isinstance(n8n["last_execution_available"], bool), "invalid n8n availability")
    for key in ("active", "manual_trigger_only", "scheduled_trigger_present", "can_claim_notification_events", "can_send_email"):
        tri_bool(n8n[key], f"n8n.{key}")
    require(n8n["error_code"] is None or n8n["error_code"] in {"SOURCE_UNAVAILABLE", "CONTRACT_CONFLICT"}, "invalid n8n safe error code")

def validate_artifact_object(value: Any, pending_allowed: bool) -> None:
    value = exact_keys(value, ROOT_KEYS, "artifact")
    require(value["schema_version"] == "notifications-n0-evidence/v1", "invalid schema version")
    require(value["environment"] == "DEV", "environment must be DEV")
    require(isinstance(value["generated_at_utc"], str) and value["generated_at_utc"].endswith("Z"), "invalid timestamp")
    require(isinstance(value["github_head_sha"], str) and HEAD_SHA.fullmatch(value["github_head_sha"]), "invalid head SHA")
    validate_migrations(value["migrations"])
    validate_database(value["database"])
    validate_notification(value["notification_aggregates"])
    validate_intake(value["intake_aggregates"])
    validate_payment_receipt(value["payment_receipt_aggregates"])
    validate_storage(value["storage_metadata"])
    validate_external(value)
    send_mode = exact_keys(value["send_mode"], {"state", "reason"}, "send_mode")
    require(send_mode == {"state": "UNKNOWN_BY_DESIGN", "reason": "runtime secret values are not read by this audit"}, "SEND_MODE contract mismatch")
    source_status = exact_keys(value["source_status"], {"database", "dispatcher", "n8n", "github_source"}, "source_status")
    for key, status in source_status.items():
        require(status in {"available", "unavailable", "not_collected"}, f"invalid source status: {key}")
    privacy = exact_keys(value["privacy_validation"], {"status"}, "privacy_validation")
    require(privacy["status"] in ({"PENDING", "PASS"} if pending_allowed else {"PASS"}), "privacy validation did not pass")
    require(exact_keys(value["cleanup_status"], {"status"}, "cleanup_status") == {"status": "PASS"}, "cleanup did not pass")


def parse_jsonl(path: Path) -> dict[str, Any]:
    sections: dict[str, Any] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise AuditError("database output was not strict JSONL") from exc
        item = exact_keys(item, {"section", "data"}, "database JSONL item")
        section = safe_name(item["section"], "database section")
        require(section not in sections, "duplicate database section")
        sections[section] = item["data"]
    expected = {"migrations", "database", "notification_aggregates", "intake_aggregates", "provider_aggregates", "receipt_link_aggregates", "evidence_aggregates", "outbox_aggregates", "payment_request_aggregates", "storage_metadata"}
    require(set(sections) == expected, "database output sections differ from the contract")
    return sections


def load_optional_json(path: Path | None, status: str) -> Any:
    if status != "available":
        return None
    require(path is not None and path.is_file(), "available metadata file is missing")
    return json.loads(path.read_text(encoding="utf-8"))


def source_sha256(source_file: Path | None) -> str | None:
    if source_file is None or not source_file.is_file():
        return None
    return hashlib.sha256(source_file.read_bytes()).hexdigest()


def summarize_dispatcher(metadata: Any, body_path: Path | None, status: str, source_file: Path | None) -> dict[str, Any]:
    result = {"metadata_available": False, "deployed": None, "verify_jwt": None, "runtime_source_sha256": None, "github_source_sha256": source_sha256(source_file), "match": None, "method": "OFFICIAL_MANAGEMENT_API_GET"}
    if status != "available":
        return result
    records = metadata if isinstance(metadata, list) else metadata.get("data", []) if isinstance(metadata, dict) else []
    require(isinstance(records, list), "dispatcher metadata is not a list")
    selected = None
    for record in records:
        if isinstance(record, dict) and (record.get("slug") == "send-notification" or record.get("name") == "send-notification"):
            selected = record
            break
    result["metadata_available"] = True
    result["deployed"] = selected is not None
    if selected is not None and isinstance(selected.get("verify_jwt"), bool):
        result["verify_jwt"] = selected["verify_jwt"]
    if selected is not None and body_path is not None and body_path.is_file():
        result["runtime_source_sha256"] = hashlib.sha256(body_path.read_bytes()).hexdigest()
    if result["runtime_source_sha256"] is not None and result["github_source_sha256"] is not None:
        result["match"] = result["runtime_source_sha256"] == result["github_source_sha256"]
    return result

def summarize_n8n(metadata: Any, status: str) -> dict[str, Any]:
    result = {"reachable": False, "relevant_workflow_found": False, "active": None, "manual_trigger_only": None, "scheduled_trigger_present": None, "can_claim_notification_events": None, "can_send_email": None, "last_execution_available": False, "error_code": "SOURCE_UNAVAILABLE", "method": "API_GET_METADATA_ONLY"}
    if status != "available":
        return result
    records = metadata if isinstance(metadata, list) else metadata.get("data", []) if isinstance(metadata, dict) else []
    require(isinstance(records, list), "n8n metadata is not a list")
    matches = []
    for record in records:
        if not isinstance(record, dict):
            continue
        name = str(record.get("name", "")).lower()
        if "notification" in name or "notificacion" in name or "flux" in name:
            matches.append(record)
    result["reachable"] = True
    result["relevant_workflow_found"] = bool(matches)
    result["error_code"] = None
    if matches:
        result["active"] = any(item.get("active") is True for item in matches)
        nodes = [node for item in matches for node in (item.get("nodes") or []) if isinstance(node, dict)]
        node_types = [str(node.get("type", "")).lower() for node in nodes]
        serialized_parameters = json.dumps([node.get("parameters", {}) for node in nodes], sort_keys=True).lower()
        manual_trigger = any("manualtrigger" in item for item in node_types)
        scheduled_trigger = any("scheduletrigger" in item or "cron" in item for item in node_types)
        result["manual_trigger_only"] = manual_trigger and not scheduled_trigger
        result["scheduled_trigger_present"] = scheduled_trigger
        result["can_claim_notification_events"] = any(token in serialized_parameters for token in ("claim_notification", "notification_events", "send-notification"))
        result["can_send_email"] = any("email" in item or "smtp" in item or "resend" in item for item in node_types)
    return result

def build(args: argparse.Namespace) -> None:
    db_path = Path(args.db_jsonl)
    dispatcher_metadata_path = Path(args.dispatcher_metadata) if args.dispatcher_metadata else None
    dispatcher_body_path = Path(args.dispatcher_body) if args.dispatcher_body else None
    n8n_metadata_path = Path(args.n8n_metadata) if args.n8n_metadata else None
    source_file = Path(args.source_file) if args.source_file else None
    sections = parse_jsonl(db_path)
    dispatcher_metadata = load_optional_json(dispatcher_metadata_path, args.dispatcher_status)
    n8n_metadata = load_optional_json(n8n_metadata_path, args.n8n_status)
    dispatcher_summary = summarize_dispatcher(dispatcher_metadata, dispatcher_body_path, args.dispatcher_status, source_file)
    n8n_summary = summarize_n8n(n8n_metadata, args.n8n_status)
    for temporary_path in (db_path, dispatcher_metadata_path, dispatcher_body_path, n8n_metadata_path):
        if temporary_path is not None and temporary_path.is_file():
            temporary_path.unlink()
    require(all(path is None or not path.exists() for path in (db_path, dispatcher_metadata_path, dispatcher_body_path, n8n_metadata_path)), "raw source cleanup failed")
    artifact = {
        "schema_version": "notifications-n0-evidence/v1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "github_head_sha": args.github_head_sha.lower(),
        "environment": "DEV",
        "migrations": sections["migrations"],
        "database": sections["database"],
        "notification_aggregates": sections["notification_aggregates"],
        "intake_aggregates": {**sections["intake_aggregates"], "providers": sections["provider_aggregates"]},
        "payment_receipt_aggregates": {"receipt_links": sections["receipt_link_aggregates"], "evidence": sections["evidence_aggregates"], "outbox": sections["outbox_aggregates"], "payment_requests": sections["payment_request_aggregates"]},
        "storage_metadata": sections["storage_metadata"],
        "dispatcher": dispatcher_summary,
        "n8n": n8n_summary,
        "send_mode": {"state": "UNKNOWN_BY_DESIGN", "reason": "runtime secret values are not read by this audit"},
        "source_status": {"database": "available", "dispatcher": args.dispatcher_status, "n8n": args.n8n_status, "github_source": "available" if args.source_file and Path(args.source_file).is_file() else "unavailable"},
        "privacy_validation": {"status": "PENDING"},
        "cleanup_status": {"status": "PASS"},
    }
    validate_artifact_object(artifact, pending_allowed=True)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(artifact, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)


def validate_final(args: argparse.Namespace) -> None:
    output = Path(args.artifact)
    require(output.is_file(), "artifact is missing")
    value = json.loads(output.read_text(encoding="utf-8"))
    validate_artifact_object(value, pending_allowed=True)
    value["privacy_validation"] = {"status": "PASS"}
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"))
    for pattern in FORBIDDEN_VALUE_PATTERNS:
        require(pattern.search(serialized) is None, "forbidden value pattern")
    for name in SENSITIVE_ENV_NAMES:
        secret = os.environ.get(name, "")
        if len(secret) >= 4:
            require(secret not in serialized, "sensitive environment value present")
    validate_artifact_object(value, pending_allowed=False)
    temporary = output.with_suffix(".validated.tmp")
    temporary.write_text(serialized + "\n", encoding="utf-8")
    temporary.replace(output)


def strip_sql_literals(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"'(?:''|[^'])*'", "''", sql, flags=re.S)
    return sql


def static_checks(args: argparse.Namespace) -> None:
    root = Path(args.root)
    workflow_path = root / ".github/workflows/notifications-n0-dev-readonly-evidence.yml"
    sql_path = root / "ops/notifications/n0-readonly-evidence/audit.sql"
    validator_path = root / "ops/notifications/n0-readonly-evidence/validate_artifact.py"
    readme_path = root / "ops/notifications/n0-readonly-evidence/README.md"
    for path in (workflow_path, sql_path, validator_path, readme_path):
        require(path.is_file(), f"missing required file: {path.name}")
    if args.changed_files:
        changed = {line.strip() for line in Path(args.changed_files).read_text(encoding="utf-8").splitlines() if line.strip()}
        require(changed <= ALLOWED_FILES, "change set exceeds the R2A allowlist")
    sql = sql_path.read_text(encoding="utf-8")
    require(sql.startswith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"), "SQL must begin with the read-only transaction")
    require(sql.rstrip().endswith("COMMIT;"), "SQL must end with COMMIT")
    require("SET LOCAL statement_timeout" in sql and "SET LOCAL lock_timeout" in sql and "SET LOCAL idle_in_transaction_session_timeout" in sql, "SQL timeouts are missing")
    normalized = strip_sql_literals(sql)
    prohibited_sql = r"\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|VACUUM|ANALYZE|REFRESH|REINDEX|CLUSTER|PERFORM)\b|\bCOMMENT\s+ON\b|\bCOPY\s+(?:FROM|TO\s+PROGRAM)\b|\bEXECUTE\b|\bFOR\s+(UPDATE|SHARE)\b|\b(?:SET|RESET)\s+ROLE\b|\bSESSION\s+AUTHORIZATION\b|pg_sleep|dblink|http_"
    require(re.search(prohibited_sql, normalized, flags=re.I) is None, "SQL contains a prohibited operation")
    require(re.search(r"\bSELECT\s+\*", normalized, flags=re.I) is None, "SELECT star is prohibited")
    require(re.search(r"^\s*\\(?:copy|o|w|!|i|ir)\b", normalized, flags=re.I | re.M) is None, "unsafe psql command")
    require(re.search(r"\bSELECT\s+public\.", normalized, flags=re.I) is None, "application function invocation is prohibited")
    workflow = workflow_path.read_text(encoding="utf-8")
    require("pull_request_target" not in workflow and "schedule:" not in workflow and "inputs:" not in workflow, "unsafe workflow trigger")
    require("pull_request:" in workflow and "push:" in workflow and "workflow_dispatch:" in workflow, "required workflow triggers are missing")
    require("static_checks:" in workflow and "collect_dev_evidence:" in workflow, "static/live job split is missing")
    static_block = workflow.split("static_checks:", 1)[1].split("collect_dev_evidence:", 1)[0]
    live_block = workflow.split("collect_dev_evidence:", 1)[1]
    require("environment:" not in static_block and "secrets." not in static_block, "static job may not use environment or secrets")
    require("environment: DEV" in live_block, "live job must use DEV environment")
    require("github.repository == 'ramon1415/catalogo-proveedores-flux'" in live_block and "github.ref == 'refs/heads/dev'" in live_block, "live job identity guard is missing")
    require("github.event_name == 'push' || github.event_name == 'workflow_dispatch'" in live_block, "live event guard is missing")
    require("actions/checkout@11d5960a326750d5838078e36cf38b85af677262" in workflow, "checkout action is not pinned")
    require("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in workflow, "upload action is not pinned")
    retention = [int(value) for value in re.findall(r"retention-days:\s*(\d+)", workflow)]
    require(retention and max(retention) <= 7, "artifact retention exceeds seven days")
    require("path: .audit-output/artifact.json" in live_block, "artifact upload path is not singular")
    require("curl" in live_block and "-X GET" in live_block, "metadata requests must declare GET")
    require(re.search(r"curl[^\n]*(?:-X|--request)\s+(POST|PUT|PATCH|DELETE)", live_block, re.I) is None, "workflow contains a mutating HTTP method")
    require("supabase functions deploy" not in workflow.lower() and "/functions/v1/" not in workflow.lower(), "dispatcher deployment or invocation is prohibited")
    require("resend" not in workflow.lower(), "email delivery endpoints are prohibited")
    require("prod" not in workflow.lower(), "production references are prohibited")
    require("set -x" not in workflow and "printenv" not in workflow and "env |" not in workflow, "workflow could expose secrets")
    readme = readme_path.read_text(encoding="utf-8")
    for phrase in ("UNKNOWN_BY_DESIGN", "fail-closed", "R2B", "does not enable N1", "no PII", "read-only"):
        require(phrase.lower() in readme.lower(), f"README is missing: {phrase}")
    compile(validator_path.read_text(encoding="utf-8"), str(validator_path), "exec")


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    static_parser = subparsers.add_parser("static")
    static_parser.add_argument("--root", default=".")
    static_parser.add_argument("--changed-files")
    static_parser.set_defaults(func=static_checks)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--db-jsonl", required=True)
    build_parser.add_argument("--dispatcher-metadata")
    build_parser.add_argument("--dispatcher-body")
    build_parser.add_argument("--dispatcher-status", choices=("available", "unavailable", "not_collected"), required=True)
    build_parser.add_argument("--n8n-metadata")
    build_parser.add_argument("--n8n-status", choices=("available", "unavailable", "not_collected"), required=True)
    build_parser.add_argument("--source-file")
    build_parser.add_argument("--github-head-sha", required=True)
    build_parser.add_argument("--output", required=True)
    build_parser.set_defaults(func=build)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--artifact", required=True)
    validate_parser.set_defaults(func=validate_final)
    args = parser.parse_args()
    try:
        args.func(args)
        if args.command == "static":
            print("STATIC_VALIDATION_PASS")
        elif args.command == "validate":
            print("PRIVACY_VALIDATION_PASS")
        return 0
    except Exception:
        if args.command == "validate":
            print("PRIVACY_VALIDATION_FAILED", file=sys.stderr)
        else:
            print("AUDIT_VALIDATION_FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
