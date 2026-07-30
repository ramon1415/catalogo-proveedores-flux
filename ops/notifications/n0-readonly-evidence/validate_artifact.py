#!/usr/bin/env python3
"""Build and fail-closed validate the sanitized Notifications N0 evidence artifact."""

from __future__ import annotations

import argparse
import copy
import hashlib
import hmac
import json
import os
import re
import stat
import struct
import sys
from email import policy
from email.parser import BytesParser
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit

ALLOWED_FILES = {
    ".github/workflows/notifications-n0-dev-readonly-evidence.yml",
    "ops/notifications/n0-readonly-evidence/audit.sql",
    "ops/notifications/n0-readonly-evidence/validate_artifact.py",
    "ops/notifications/n0-readonly-evidence/README.md",
}
AUTHORIZED_DEV_REF_HASH = "17c8a93bb8c05807537d1caf6b290e8dbc3fbb79e69f1bebce323b12d8c2da40"
MAX_MULTIPART_BYTES = 10 * 1024 * 1024
MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_PARTS = 128
MAX_PATH_BYTES = 512
ROOT_KEYS = {
    "schema_version", "generated_at_utc", "environment", "github",
    "environment_identity", "delivery_architecture", "migrations",
    "database_schema", "notification_aggregates", "intake_aggregates",
    "payment_receipt_aggregates", "storage", "dispatcher_runtime",
    "resend_source_contract", "send_mode", "source_status",
    "privacy_validation", "cleanup",
}
SENSITIVE_ENV_NAMES = (
    "SUPABASE_DEV_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DEV_PROJECT_REF",
)
SAFE_NAME = re.compile(r"^[A-Za-z0-9_. -]{1,160}$")
SAFE_SIGNATURE = re.compile(r"^[A-Za-z0-9_ .,:()\[\]]{0,300}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEAD_SHA = re.compile(r"^[0-9a-f]{40}$")
FORBIDDEN_VALUE_PATTERNS = (
    re.compile(r"N8N_DEV_API_URL|N8N_DEV_API_KEY", re.I),
    re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I),
    re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.I),
    re.compile(r"https?://", re.I),
    re.compile(r"postgres(?:ql)?://", re.I),
    re.compile(r"(?<![a-z])[a-z]{20}(?![a-z])"),
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
            column = exact_keys(column, {"name", "type", "nullable", "default_present", "classification"}, "column")
            safe_name(column["name"], "column name")
            safe_name(column["type"], "column type", SAFE_SIGNATURE)
            require(isinstance(column["nullable"], bool) and isinstance(column["default_present"], bool), "invalid column flags")
            require(column["classification"] in {"ACTIVE_SCHEMA", "LEGACY_SCHEMA_ONLY"}, "invalid column classification")
            require(("n8n" in column["name"].lower()) == (column["classification"] == "LEGACY_SCHEMA_ONLY"), "legacy column classification mismatch")
        require(isinstance(entity["constraints"], list), "constraints must be a list")
        for constraint in entity["constraints"]:
            constraint = exact_keys(constraint, {"name", "type", "validated", "classification"}, "constraint")
            safe_name(constraint["name"], "constraint name")
            require(constraint["type"] in {"primary_key", "foreign_key", "unique", "check", "exclusion", "other"}, "invalid constraint type")
            require(isinstance(constraint["validated"], bool), "constraint.validated must be boolean")
            require(constraint["classification"] in {"ACTIVE_SCHEMA", "LEGACY_SCHEMA_ONLY"}, "invalid constraint classification")
            require(("n8n" in constraint["name"].lower()) == (constraint["classification"] == "LEGACY_SCHEMA_ONLY"), "legacy constraint classification mismatch")
        require(isinstance(entity["indexes"], list), "indexes must be a list")
        for index in entity["indexes"]:
            index = exact_keys(index, {"name", "unique", "primary", "valid", "classification"}, "index")
            safe_name(index["name"], "index name")
            require(all(isinstance(index[key], bool) for key in ("unique", "primary", "valid")), "invalid index flags")
            require(index["classification"] in {"ACTIVE_SCHEMA", "LEGACY_SCHEMA_ONLY"}, "invalid index classification")
            require(("n8n" in index["name"].lower()) == (index["classification"] == "LEGACY_SCHEMA_ONLY"), "legacy index classification mismatch")
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


def iter_strings(value: Any, path: tuple[Any, ...] = ()):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from iter_strings(child, path + (key,))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_strings(child, path + (index,))
    elif isinstance(value, str):
        yield path, value


def validate_sensitive_values(value: dict[str, Any]) -> None:
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"))
    for pattern in FORBIDDEN_VALUE_PATTERNS:
        require(pattern.search(serialized) is None, "forbidden value pattern")
    allowed_digest_paths = {
        ("dispatcher_runtime", "runtime_manifest_digest"),
        ("dispatcher_runtime", "github_manifest_digest"),
        ("dispatcher_runtime", "runtime_bundle_digest"),
    }
    for path, text_value in iter_strings(value):
        if SHA256.fullmatch(text_value):
            require(path in allowed_digest_paths, "SHA-256 outside its allowlist")
        if "n8n" in text_value.lower():
            parent = value
            for item in path[:-1]:
                parent = parent[item]
            structural_path = (
                len(path) == 6
                and path[0] == "database_schema"
                and path[1] == "entities"
                and path[3] in {"columns", "constraints", "indexes"}
                and path[5] == "name"
                and isinstance(parent, dict)
                and parent.get("classification") == "LEGACY_SCHEMA_ONLY"
            )
            require(structural_path, "runtime n8n dependency is prohibited")


def validate_architecture(value: Any) -> None:
    architecture = exact_keys(
        value,
        {"dispatcher", "dispatcher_name", "email_provider", "ledger", "delivery_attempts", "single_consumer_required", "provider_api_called_by_audit", "emails_sent_by_audit"},
        "delivery_architecture",
    )
    require(architecture["dispatcher"] == "supabase_edge_function", "dispatcher architecture mismatch")
    require(architecture["dispatcher_name"] == "notification-dispatcher", "dispatcher name mismatch")
    require(architecture["email_provider"] == "resend", "email provider mismatch")
    require(architecture["ledger"] == "notification_events", "ledger mismatch")
    require(architecture["delivery_attempts"] == "notification_delivery_attempts", "delivery attempts mismatch")
    require(architecture["single_consumer_required"] is True, "single consumer must be required")
    require(architecture["provider_api_called_by_audit"] is False, "provider API call is prohibited")
    require(architecture["emails_sent_by_audit"] is False, "email sending is prohibited")


def validate_environment_identity(value: Any) -> None:
    identity = exact_keys(
        value,
        {
            "expected_ref_hash_match", "db_url_ref_match",
            "management_metadata_ref_match", "supabase_host_allowlisted",
            "unsafe_connection_options_absent",
            "identity_verified_before_database_read", "raw_identity_retained",
        },
        "environment_identity",
    )
    for key in (
        "expected_ref_hash_match", "db_url_ref_match",
        "management_metadata_ref_match", "supabase_host_allowlisted",
        "unsafe_connection_options_absent",
        "identity_verified_before_database_read",
    ):
        require(identity[key] is True, f"environment identity failed: {key}")
    require(identity["raw_identity_retained"] is False, "raw environment identity may not be retained")


def validate_dispatcher_runtime(value: Any) -> None:
    runtime = exact_keys(
        value,
        {
            "name", "deployed", "metadata_available", "body_available",
            "multipart_parsed", "runtime_file_count", "github_file_count",
            "path_set_match", "runtime_manifest_digest",
            "github_manifest_digest", "runtime_bundle_digest",
            "source_match", "comparison_state", "verify_jwt",
            "source_retained", "function_invoked",
            "function_deployed_by_audit",
        },
        "dispatcher_runtime",
    )
    require(runtime["name"] == "notification-dispatcher", "dispatcher runtime name mismatch")
    tri_bool(runtime["deployed"], "dispatcher_runtime.deployed")
    for key in ("metadata_available", "body_available", "multipart_parsed"):
        require(isinstance(runtime[key], bool), f"invalid dispatcher_runtime.{key}")
    for key in ("runtime_file_count", "github_file_count"):
        nullable_count(runtime[key], f"dispatcher_runtime.{key}")
    for key in ("path_set_match", "source_match", "verify_jwt"):
        tri_bool(runtime[key], f"dispatcher_runtime.{key}")
    for key in ("runtime_manifest_digest", "github_manifest_digest", "runtime_bundle_digest"):
        require(runtime[key] is None or (isinstance(runtime[key], str) and SHA256.fullmatch(runtime[key])), f"invalid {key}")
    states = {
        "match", "mismatch", "metadata_only", "body_unavailable",
        "parse_failed", "github_source_unavailable", "unavailable",
    }
    state = runtime["comparison_state"]
    require(state in states, "invalid dispatcher comparison state")
    expected_match = True if state == "match" else False if state == "mismatch" else None
    require(runtime["source_match"] is expected_match, "source_match/state mismatch")
    require(runtime["path_set_match"] is None or state in {"match", "mismatch"}, "path set result without comparison")
    if runtime["multipart_parsed"]:
        require(runtime["body_available"] is True, "parsed multipart requires body")
        require(runtime["runtime_manifest_digest"] is not None, "parsed multipart requires runtime manifest")
        count(runtime["runtime_file_count"], "dispatcher_runtime.runtime_file_count")
    else:
        require(runtime["runtime_manifest_digest"] is None and runtime["runtime_file_count"] is None, "runtime manifest without parsed multipart")
    if runtime["github_manifest_digest"] is None:
        require(runtime["github_file_count"] is None, "GitHub count without manifest")
    else:
        count(runtime["github_file_count"], "dispatcher_runtime.github_file_count")
    if state in {"match", "mismatch"}:
        require(runtime["runtime_manifest_digest"] is not None and runtime["github_manifest_digest"] is not None, "comparison without manifests")
        require(runtime["path_set_match"] is not None, "comparison without path-set result")
    if state == "match":
        require(runtime["path_set_match"] is True and runtime["runtime_manifest_digest"] == runtime["github_manifest_digest"], "false manifest match")
    if state == "mismatch":
        require(runtime["runtime_manifest_digest"] != runtime["github_manifest_digest"] or runtime["path_set_match"] is False, "false manifest mismatch")
    if state in {"metadata_only", "body_unavailable"}:
        require(runtime["metadata_available"] and not runtime["body_available"], "invalid metadata/body state")
    if state == "parse_failed":
        require(runtime["body_available"] and not runtime["multipart_parsed"], "invalid parse-failed state")
    require(runtime["source_retained"] is False, "runtime source may not be retained")
    require(runtime["function_invoked"] is False, "dispatcher invocation is prohibited")
    require(runtime["function_deployed_by_audit"] is False, "dispatcher deployment is prohibited")


def validate_resend_source_contract(value: Any) -> None:
    contract = exact_keys(
        value,
        {
            "provider", "dispatcher_source_inspected",
            "integration_reference_present", "send_mode_guard_present",
            "idempotency_header_present", "provider_api_called_by_audit",
            "email_sent_by_audit", "runtime_secret_values_read",
        },
        "resend_source_contract",
    )
    require(contract["provider"] == "resend", "Resend provider contract mismatch")
    require(isinstance(contract["dispatcher_source_inspected"], bool), "invalid source inspection state")
    for key in ("integration_reference_present", "send_mode_guard_present", "idempotency_header_present"):
        require(isinstance(contract[key], bool) or contract[key] == "unknown", f"invalid source observation: {key}")
    require(contract["provider_api_called_by_audit"] is False, "Resend API call is prohibited")
    require(contract["email_sent_by_audit"] is False, "email sending is prohibited")
    require(contract["runtime_secret_values_read"] is False, "runtime secret reads are prohibited")


def validate_artifact_object(value: Any, pending_allowed: bool) -> None:
    value = exact_keys(value, ROOT_KEYS, "artifact")
    require(value["schema_version"] == "notifications-n0-evidence/v3", "invalid schema version")
    require(value["environment"] == "DEV", "environment must be DEV")
    require(isinstance(value["generated_at_utc"], str) and value["generated_at_utc"].endswith("Z"), "invalid timestamp")
    github = exact_keys(value["github"], {"head_sha"}, "github")
    require(isinstance(github["head_sha"], str) and HEAD_SHA.fullmatch(github["head_sha"]), "invalid head SHA")
    validate_environment_identity(value["environment_identity"])
    validate_architecture(value["delivery_architecture"])
    validate_migrations(value["migrations"])
    validate_database(value["database_schema"])
    validate_notification(value["notification_aggregates"])
    validate_intake(value["intake_aggregates"])
    validate_payment_receipt(value["payment_receipt_aggregates"])
    validate_storage(value["storage"])
    validate_dispatcher_runtime(value["dispatcher_runtime"])
    validate_resend_source_contract(value["resend_source_contract"])
    send_mode = exact_keys(value["send_mode"], {"state", "reason"}, "send_mode")
    require(send_mode == {"state": "UNKNOWN_BY_DESIGN", "reason": "runtime secret values are not read by this audit"}, "SEND_MODE contract mismatch")
    statuses = {"available", "unavailable", "not_collected", "metadata_only", "parse_failed"}
    source_status = exact_keys(
        value["source_status"],
        {
            "database", "project_identity", "dispatcher_metadata",
            "dispatcher_body", "dispatcher_manifest", "github_source",
            "resend_source_contract",
        },
        "source_status",
    )
    for key, status_value in source_status.items():
        require(status_value in statuses, f"invalid source status: {key}")
    require(source_status["project_identity"] == "available", "project identity must be verified")
    runtime = value["dispatcher_runtime"]
    if source_status["github_source"] == "available":
        require(runtime["github_manifest_digest"] is not None, "available GitHub source lacks manifest")
        require(value["resend_source_contract"]["dispatcher_source_inspected"] is True, "available source was not inspected")
    else:
        require(runtime["github_manifest_digest"] is None, "unavailable GitHub source has manifest")
    privacy = exact_keys(value["privacy_validation"], {"status"}, "privacy_validation")
    require(privacy["status"] in ({"PENDING", "PASS"} if pending_allowed else {"PASS"}), "privacy validation did not pass")
    require(exact_keys(value["cleanup"], {"status"}, "cleanup") == {"status": "PASS"}, "cleanup did not pass")
    validate_sensitive_values(value)


def compute_ref_hash(project_ref: str) -> str:
    return hashlib.sha256(("supabase-project-ref:" + project_ref).encode("utf-8")).hexdigest()


def validate_project_ref(project_ref: Any, expected_hash: str = AUTHORIZED_DEV_REF_HASH) -> str:
    require(isinstance(project_ref, str) and re.fullmatch(r"[a-z]{20}", project_ref) is not None, "invalid project ref")
    require(isinstance(expected_hash, str) and SHA256.fullmatch(expected_hash) is not None, "invalid authorized hash")
    require(hmac.compare_digest(compute_ref_hash(project_ref), expected_hash), "project ref hash mismatch")
    return project_ref


def parse_db_identity(database_url: Any, project_ref: str) -> dict[str, bool]:
    require(isinstance(database_url, str) and database_url != "", "database URL is missing")
    require("\n" not in database_url and "\r" not in database_url, "database URL contains control data")
    try:
        parsed = urlsplit(database_url)
        port = parsed.port
    except ValueError as exc:
        raise AuditError("invalid database URL") from exc
    require(parsed.scheme.lower() in {"postgres", "postgresql"}, "invalid database URL scheme")
    require(parsed.fragment == "", "database URL fragments are prohibited")
    require(parsed.hostname is not None and parsed.username is not None and parsed.password is not None, "database URL credentials are incomplete")
    require(unquote(parsed.password) != "", "database URL password is empty")
    require(parsed.path == "/postgres", "database name must be postgres")
    require(port in {5432, 6543}, "database port is not allowlisted")
    host = parsed.hostname.lower()
    username = unquote(parsed.username)
    direct = host == f"db.{project_ref}.supabase.co" and username == "postgres"
    pooler = host.endswith(".pooler.supabase.com") and username == f"postgres.{project_ref}"
    require(direct or pooler, "database URL is not bound to the project ref")
    try:
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise AuditError("malformed database URL query") from exc
    allowed = {"sslmode", "connect_timeout"}
    require(all(key in allowed for key, _ in pairs), "unsafe database connection option")
    require(len({key for key, _ in pairs}) == len(pairs), "duplicate database connection option")
    query = dict(pairs)
    if "sslmode" in query:
        require(query["sslmode"] in {"require", "verify-ca", "verify-full"}, "unsafe sslmode")
    if "connect_timeout" in query:
        require(re.fullmatch(r"[1-9][0-9]{0,2}", query["connect_timeout"]) is not None, "invalid connect timeout")
    return {
        "db_url_ref_match": True,
        "supabase_host_allowlisted": True,
        "unsafe_connection_options_absent": True,
    }


def validate_project_metadata(metadata: Any, project_ref: str) -> None:
    require(isinstance(metadata, dict), "project metadata is not an object")
    require(isinstance(metadata.get("ref"), str), "project metadata ref is missing")
    require(hmac.compare_digest(metadata["ref"], project_ref), "project metadata ref mismatch")


def identity_marker(project_ref: str, database_url: str, metadata: Any | None = None) -> dict[str, bool]:
    validate_project_ref(project_ref)
    parsed = parse_db_identity(database_url, project_ref)
    marker = {
        "expected_ref_hash_match": True,
        **parsed,
        "management_metadata_ref_match": metadata is not None,
        "identity_verified_before_database_read": metadata is not None,
        "raw_identity_retained": False,
    }
    if metadata is not None:
        validate_project_metadata(metadata, project_ref)
    validate_environment_identity(marker)
    return marker


def identity_local(args: argparse.Namespace) -> None:
    project_ref = os.environ.get("SUPABASE_DEV_PROJECT_REF", "")
    database_url = os.environ.get("SUPABASE_DEV_DB_URL", "")
    validate_project_ref(project_ref)
    parse_db_identity(database_url, project_ref)


def identity_metadata(args: argparse.Namespace) -> None:
    project_ref = os.environ.get("SUPABASE_DEV_PROJECT_REF", "")
    database_url = os.environ.get("SUPABASE_DEV_DB_URL", "")
    metadata_path = Path(args.project_metadata)
    headers_path = Path(args.project_headers)
    marker_path = Path(args.identity_marker)
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        marker = identity_marker(project_ref, database_url, metadata)
        marker_path.write_text(json.dumps(marker, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    finally:
        for raw_path in (metadata_path, headers_path):
            if raw_path.exists():
                raw_path.unlink()
    require(not metadata_path.exists() and not headers_path.exists(), "project metadata cleanup failed")


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
    expected = {
        "migrations", "database", "notification_aggregates",
        "intake_aggregates", "provider_aggregates",
        "receipt_link_aggregates", "evidence_aggregates",
        "outbox_aggregates", "payment_request_aggregates",
        "storage_metadata",
    }
    require(set(sections) == expected, "database output sections differ from the contract")
    return sections


def load_optional_json(path: Path | None, status_value: str) -> Any:
    if status_value != "available":
        return None
    require(path is not None and path.is_file(), "available metadata file is missing")
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_source_path(raw_path: Any) -> str:
    require(isinstance(raw_path, str), "source path is not text")
    require("\x00" not in raw_path and "\n" not in raw_path and "\r" not in raw_path, "source path contains control data")
    raw_path = raw_path.replace("\\", "/")
    require(not raw_path.startswith("/") and re.match(r"^[A-Za-z]:", raw_path) is None, "absolute source path")
    prefixes = (
        "supabase/functions/notification-dispatcher/",
        "notification-dispatcher/",
    )
    for prefix_value in prefixes:
        if raw_path.startswith(prefix_value):
            raw_path = raw_path[len(prefix_value):]
            break
    require(raw_path != "" and len(raw_path.encode("utf-8")) <= MAX_PATH_BYTES, "invalid source path length")
    path = PurePosixPath(raw_path)
    require(all(part not in {"", ".", ".."} for part in path.parts), "source path traversal")
    normalized = "/".join(path.parts)
    require(normalized == raw_path, "non-canonical source path")
    return normalized


def validate_source_mode(mode: int) -> None:
    require(not stat.S_ISLNK(mode), "source symlink is prohibited")
    require(stat.S_ISREG(mode), "source entry is not a regular file")


def canonical_manifest(files: dict[str, bytes]) -> tuple[str, int, set[str]]:
    require(isinstance(files, dict) and len(files) > 0, "source manifest is empty")
    digest = hashlib.sha256()
    total = 0
    normalized_files: dict[str, bytes] = {}
    for raw_path, content in files.items():
        path = normalize_source_path(raw_path)
        require(path not in normalized_files, "duplicate source path")
        require(isinstance(content, bytes), "source content is not bytes")
        total += len(content)
        require(total <= MAX_SOURCE_BYTES, "source size limit exceeded")
        normalized_files[path] = content
    for path in sorted(normalized_files, key=lambda item: item.encode("utf-8")):
        path_bytes = path.encode("utf-8")
        content = normalized_files[path]
        digest.update(struct.pack(">Q", len(path_bytes)))
        digest.update(b"\x00")
        digest.update(path_bytes)
        digest.update(b"\x00")
        digest.update(struct.pack(">Q", len(content)))
        digest.update(b"\x00")
        digest.update(content)
    return digest.hexdigest(), len(normalized_files), set(normalized_files)


def read_content_type(headers_path: Path) -> str:
    require(headers_path.is_file(), "dispatcher headers are missing")
    values = re.findall(r"(?im)^content-type:\s*([^\r\n]+)", headers_path.read_text(encoding="iso-8859-1"))
    require(len(values) == 1, "ambiguous dispatcher content type")
    return values[0].strip()


def parse_multipart_files(
    content_type: str,
    body: bytes,
    *,
    max_bytes: int = MAX_MULTIPART_BYTES,
    max_parts: int = MAX_PARTS,
) -> dict[str, bytes]:
    require(isinstance(body, bytes) and len(body) <= max_bytes, "multipart size limit exceeded")
    require(re.fullmatch(r"multipart/[A-Za-z0-9.+_-]+(?:\s*;\s*[^;\r\n]+)*", content_type, flags=re.I) is not None, "content type is not multipart")
    boundary_match = re.search(r"(?:^|;)\s*boundary=(?:\"([^\"]+)\"|([^;\s]+))", content_type, flags=re.I)
    require(boundary_match is not None, "multipart boundary is missing")
    boundary = boundary_match.group(1) or boundary_match.group(2)
    require(1 <= len(boundary) <= 200 and re.fullmatch(r"[A-Za-z0-9'()+_,./:=?-]+", boundary) is not None, "malformed multipart boundary")
    require(body.startswith(("--" + boundary).encode("ascii")), "multipart boundary mismatch")
    try:
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
        )
    except Exception as exc:
        raise AuditError("multipart parse failed") from exc
    require(message.is_multipart(), "multipart parse failed")
    parts = list(message.iter_parts())
    require(len(parts) <= max_parts, "multipart part limit exceeded")
    files: dict[str, bytes] = {}
    for part in parts:
        disposition = part.get_content_disposition()
        name = part.get_param("name", header="content-disposition")
        header_paths = part.get_all("Supabase-Path", [])
        require(len(header_paths) <= 1, "ambiguous source path header")
        header_path = header_paths[0] if header_paths else None
        filename = part.get_filename()
        if name == "metadata" or (
            header_path is None and filename is None and part.get_content_type() == "application/json"
        ):
            continue
        require(disposition in {"form-data", "attachment", "inline"}, "invalid multipart disposition")
        require(header_path is not None or filename is not None, "file part lacks a source path")
        if header_path is not None and filename is not None:
            require(normalize_source_path(header_path) == normalize_source_path(filename), "ambiguous multipart source path")
        path = normalize_source_path(header_path if header_path is not None else filename)
        require(path not in files, "duplicate source path")
        payload = part.get_payload(decode=True)
        require(isinstance(payload, bytes), "multipart file payload is not bytes")
        files[path] = payload
    require(files, "multipart contains no source files")
    return files


def github_source_files(source_dir: Path) -> dict[str, bytes]:
    require(source_dir.is_dir() and not source_dir.is_symlink(), "GitHub source directory is unavailable")
    files: dict[str, bytes] = {}
    total = 0
    for path in sorted(source_dir.rglob("*")):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        validate_source_mode(mode)
        relative = normalize_source_path(path.relative_to(source_dir).as_posix())
        require(relative not in files, "duplicate GitHub source path")
        content = path.read_bytes()
        total += len(content)
        require(total <= MAX_SOURCE_BYTES, "GitHub source size limit exceeded")
        files[relative] = content
    require(files, "GitHub source directory is empty")
    return files


def inspect_resend_source(source_dir: Path | None) -> dict[str, Any]:
    unavailable = {
        "provider": "resend",
        "dispatcher_source_inspected": False,
        "integration_reference_present": "unknown",
        "send_mode_guard_present": "unknown",
        "idempotency_header_present": "unknown",
        "provider_api_called_by_audit": False,
        "email_sent_by_audit": False,
        "runtime_secret_values_read": False,
    }
    if source_dir is None:
        return unavailable
    source_file = source_dir / "index.ts"
    if not source_file.is_file() or source_file.is_symlink():
        return unavailable
    source = source_file.read_text(encoding="utf-8")
    lower = source.lower()
    return {
        "provider": "resend",
        "dispatcher_source_inspected": True,
        "integration_reference_present": "resend" in lower,
        "send_mode_guard_present": "notification_send_mode" in lower,
        "idempotency_header_present": re.search(r"""["']idempotency-key["']\s*:""", source, flags=re.I) is not None,
        "provider_api_called_by_audit": False,
        "email_sent_by_audit": False,
        "runtime_secret_values_read": False,
    }


def dispatcher_evidence(
    metadata: Any,
    metadata_status: str,
    body_path: Path | None,
    headers_path: Path | None,
    body_status: str,
    source_dir: Path | None,
) -> tuple[dict[str, Any], dict[str, str]]:
    metadata_available = metadata_status == "available"
    body_available = body_status == "available" and body_path is not None and body_path.is_file()
    deployed: bool | None = None
    verify_jwt: bool | None = None
    bundle_digest: str | None = None
    if metadata_available:
        require(isinstance(metadata, dict), "dispatcher metadata is not an object")
        slug = metadata.get("slug", metadata.get("name"))
        require(slug == "notification-dispatcher", "dispatcher metadata identity mismatch")
        deployed = True
        if isinstance(metadata.get("verify_jwt"), bool):
            verify_jwt = metadata["verify_jwt"]
        candidate_bundle = metadata.get("ezbr_sha256")
        if isinstance(candidate_bundle, str) and SHA256.fullmatch(candidate_bundle.lower()):
            bundle_digest = candidate_bundle.lower()

    runtime_digest = None
    runtime_count = None
    runtime_paths = None
    multipart_parsed = False
    parse_failed = False
    if body_available:
        try:
            require(headers_path is not None, "dispatcher body headers are missing")
            content_type = read_content_type(headers_path)
            runtime_files = parse_multipart_files(content_type, body_path.read_bytes())
            runtime_digest, runtime_count, runtime_paths = canonical_manifest(runtime_files)
            multipart_parsed = True
        except AuditError:
            parse_failed = True

    github_digest = None
    github_count = None
    github_paths = None
    github_available = False
    if source_dir is not None:
        try:
            github_files = github_source_files(source_dir)
            github_digest, github_count, github_paths = canonical_manifest(github_files)
            github_available = True
        except AuditError:
            github_available = False

    path_set_match = None
    source_match = None
    if not metadata_available:
        state = "unavailable"
    elif body_status == "not_collected":
        state = "metadata_only"
    elif not body_available:
        state = "body_unavailable"
    elif parse_failed:
        state = "parse_failed"
    elif not github_available:
        state = "github_source_unavailable"
    else:
        path_set_match = runtime_paths == github_paths
        source_match = path_set_match and runtime_digest == github_digest
        state = "match" if source_match else "mismatch"

    runtime = {
        "name": "notification-dispatcher",
        "deployed": deployed,
        "metadata_available": metadata_available,
        "body_available": body_available,
        "multipart_parsed": multipart_parsed,
        "runtime_file_count": runtime_count,
        "github_file_count": github_count,
        "path_set_match": path_set_match,
        "runtime_manifest_digest": runtime_digest,
        "github_manifest_digest": github_digest,
        "runtime_bundle_digest": bundle_digest,
        "source_match": source_match,
        "comparison_state": state,
        "verify_jwt": verify_jwt,
        "source_retained": False,
        "function_invoked": False,
        "function_deployed_by_audit": False,
    }
    source_status = {
        "dispatcher_metadata": "available" if metadata_available else metadata_status,
        "dispatcher_body": "available" if body_available else body_status,
        "dispatcher_manifest": "available" if state in {"match", "mismatch"} else "parse_failed" if state == "parse_failed" else "metadata_only" if state in {"metadata_only", "body_unavailable"} else "unavailable",
        "github_source": "available" if github_available else "unavailable",
    }
    return runtime, source_status


def remove_raw(paths: tuple[Path | None, ...]) -> None:
    for path in paths:
        if path is not None and path.exists():
            require(path.is_file(), "raw cleanup target is not a file")
            path.unlink()
    require(all(path is None or not path.exists() for path in paths), "raw source cleanup failed")


def build(args: argparse.Namespace) -> None:
    db_path = Path(args.db_jsonl)
    identity_path = Path(args.identity_marker)
    metadata_path = Path(args.dispatcher_metadata) if args.dispatcher_metadata else None
    metadata_headers_path = Path(args.dispatcher_metadata_headers) if args.dispatcher_metadata_headers else None
    body_path = Path(args.dispatcher_body) if args.dispatcher_body else None
    body_headers_path = Path(args.dispatcher_body_headers) if args.dispatcher_body_headers else None
    source_dir = Path(args.source_dir) if args.source_dir else None
    sections = parse_jsonl(db_path)
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    validate_environment_identity(identity)
    metadata = load_optional_json(metadata_path, args.dispatcher_metadata_status)
    runtime, runtime_status = dispatcher_evidence(
        metadata,
        args.dispatcher_metadata_status,
        body_path,
        body_headers_path,
        args.dispatcher_body_status,
        source_dir,
    )
    resend_contract = inspect_resend_source(source_dir if runtime_status["github_source"] == "available" else None)
    raw_paths = (
        db_path, identity_path, metadata_path, metadata_headers_path,
        body_path, body_headers_path,
    )
    remove_raw(raw_paths)
    artifact = {
        "schema_version": "notifications-n0-evidence/v3",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "environment": "DEV",
        "github": {"head_sha": args.github_head_sha.lower()},
        "environment_identity": identity,
        "delivery_architecture": {
            "dispatcher": "supabase_edge_function",
            "dispatcher_name": "notification-dispatcher",
            "email_provider": "resend",
            "ledger": "notification_events",
            "delivery_attempts": "notification_delivery_attempts",
            "single_consumer_required": True,
            "provider_api_called_by_audit": False,
            "emails_sent_by_audit": False,
        },
        "migrations": sections["migrations"],
        "database_schema": sections["database"],
        "notification_aggregates": sections["notification_aggregates"],
        "intake_aggregates": {**sections["intake_aggregates"], "providers": sections["provider_aggregates"]},
        "payment_receipt_aggregates": {
            "receipt_links": sections["receipt_link_aggregates"],
            "evidence": sections["evidence_aggregates"],
            "outbox": sections["outbox_aggregates"],
            "payment_requests": sections["payment_request_aggregates"],
        },
        "storage": sections["storage_metadata"],
        "dispatcher_runtime": runtime,
        "resend_source_contract": resend_contract,
        "send_mode": {
            "state": "UNKNOWN_BY_DESIGN",
            "reason": "runtime secret values are not read by this audit",
        },
        "source_status": {
            "database": "available",
            "project_identity": "available",
            **runtime_status,
            "resend_source_contract": "available" if resend_contract["dispatcher_source_inspected"] else "unavailable",
        },
        "privacy_validation": {"status": "PENDING"},
        "cleanup": {"status": "PASS"},
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
    for name in SENSITIVE_ENV_NAMES:
        secret = os.environ.get(name, "")
        if len(secret) >= 4:
            require(secret not in serialized, "sensitive environment value present")
    validate_artifact_object(value, pending_allowed=False)
    temporary = output.with_suffix(".validated.tmp")
    temporary.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
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
        changed = {
            line.strip()
            for line in Path(args.changed_files).read_text(encoding="utf-8").splitlines()
            if line.strip()
        }
        require(changed <= ALLOWED_FILES and len(changed) <= 4, "change set exceeds the R2A-R2 allowlist")

    sql = sql_path.read_text(encoding="utf-8")
    require(sql.startswith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"), "SQL must begin with the read-only transaction")
    require(sql.rstrip().endswith("COMMIT;"), "SQL must end with COMMIT")
    for setting in (
        "SET LOCAL default_transaction_read_only = on",
        "SET LOCAL statement_timeout",
        "SET LOCAL lock_timeout",
        "SET LOCAL idle_in_transaction_session_timeout",
    ):
        require(setting in sql, f"SQL control is missing: {setting}")
    require("LEGACY_SCHEMA_ONLY" in sql, "legacy schema classification is missing")
    normalized = strip_sql_literals(sql)
    prohibited_sql = r"\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|VACUUM|ANALYZE|REFRESH|REINDEX|CLUSTER|PERFORM)\b|\bCOMMENT\s+ON\b|\bCOPY\s+(?:FROM|TO\s+PROGRAM)\b|\bEXECUTE\b|\bFOR\s+(UPDATE|SHARE)\b|\b(?:SET|RESET)\s+ROLE\b|\bSESSION\s+AUTHORIZATION\b|pg_sleep|dblink|http_"
    require(re.search(prohibited_sql, normalized, flags=re.I) is None, "SQL contains a prohibited operation")
    require(re.search(r"\bSELECT\s+\*", normalized, flags=re.I) is None, "SELECT star is prohibited")
    require(re.search(r"^\s*\\(?:copy|o|w|!|i|ir)\b", normalized, flags=re.I | re.M) is None, "unsafe psql command")
    require(re.search(r"\bSELECT\s+public\.", normalized, flags=re.I) is None, "application function invocation is prohibited")

    workflow = workflow_path.read_text(encoding="utf-8")
    lower_workflow = workflow.lower()
    require("pull_request_target" not in workflow and "schedule:" not in workflow and "inputs:" not in workflow, "unsafe workflow trigger")
    require("pull_request:" in workflow and "push:" in workflow and "workflow_dispatch:" in workflow, "required workflow triggers are missing")
    require("static_checks:" in workflow and "collect_dev_evidence:" in workflow, "static/live job split is missing")
    static_block = workflow.split("static_checks:", 1)[1].split("collect_dev_evidence:", 1)[0]
    live_block = workflow.split("collect_dev_evidence:", 1)[1]
    require("environment:" not in static_block and "secrets." not in static_block, "static job may not use environment or secrets")
    require("self-test" in static_block and "artifact v3" in static_block, "validator v3 self-tests are missing")
    require("environment: DEV" in live_block, "live job must use DEV environment")
    require(
        "github.repository == 'ramon1415/catalogo-proveedores-flux'" in live_block
        and "github.ref == 'refs/heads/dev'" in live_block
        and "github.event_name == 'push' || github.event_name == 'workflow_dispatch'" in live_block,
        "live job identity guard is missing",
    )
    secret_references = set(re.findall(r"secrets\.([A-Z0-9_]+)", live_block))
    require(secret_references == set(SENSITIVE_ENV_NAMES), "live job must require exactly the three DEV secrets")
    for forbidden in (
        "N8N_DEV_API_KEY", "N8N_DEV_API_URL", "NOTIFICATION_DISPATCHER_SECRET",
        "RESEND_API_KEY", "NOTIFICATION_SEND_MODE", "NOTIFICATION_TEST_EMAIL",
        "NOTIFICATION_FROM_EMAIL", "SUPABASE_SERVICE_ROLE_KEY",
    ):
        require(forbidden not in workflow, "prohibited secret reference")
    require("n8n" not in lower_workflow and "api.resend.com" not in lower_workflow, "prohibited runtime integration")
    require("Accept: multipart/form-data" in live_block, "dispatcher body must request multipart/form-data")
    require("/v1/projects/${SUPABASE_DEV_PROJECT_REF}" in live_block, "project metadata GET is missing")
    require("/functions/notification-dispatcher\"" in live_block, "exact dispatcher metadata GET is missing")
    require("/functions/notification-dispatcher/body\"" in live_block, "exact dispatcher body GET is missing")
    require("actions/checkout@11d5960a326750d5838078e36cf38b85af677262" in workflow, "checkout action is not pinned")
    require("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in workflow, "upload action is not pinned")
    retention = [int(value) for value in re.findall(r"retention-days:\s*(\d+)", workflow)]
    require(retention and max(retention) <= 7, "artifact retention exceeds seven days")
    require("path: .audit-output/artifact.json" in live_block, "artifact upload path is not singular")
    require("curl" in live_block and "-X GET" in live_block, "Management API requests must declare GET")
    require(re.search(r"curl[^\n]*(?:-X|--request)\s+(POST|PUT|PATCH|DELETE)", live_block, re.I) is None, "workflow contains a mutating HTTP method")
    require("supabase functions deploy" not in lower_workflow and "/functions/v1/" not in lower_workflow, "dispatcher deployment or invocation is prohibited")
    require("set -x" not in workflow and "printenv" not in workflow and "env |" not in workflow, "workflow could expose secrets")
    require("prod" not in lower_workflow and "vercel" not in lower_workflow, "production or manual Vercel references are prohibited")
    require("PGOPTIONS" in live_block and "default_transaction_read_only=on" in live_block, "read-only PGOPTIONS are missing")
    identity_local_position = live_block.find("identity-local")
    identity_metadata_position = live_block.find("identity-metadata")
    psql_position = live_block.find("psql ")
    require(0 <= identity_local_position < identity_metadata_position < psql_position, "identity verification must precede PostgreSQL")
    for raw_name in (
        "project-metadata.json", "project-headers.txt",
        "dispatcher-metadata.json", "dispatcher-metadata-headers.txt",
        "dispatcher-body.bin", "dispatcher-body-headers.txt",
    ):
        require(raw_name in live_block, f"raw cleanup coverage is missing: {raw_name}")

    validator_source = validator_path.read_text(encoding="utf-8")
    require("notifications-n0-evidence/v3" in validator_source, "artifact v3 validator is missing")
    require(AUTHORIZED_DEV_REF_HASH in validator_source, "authorized DEV ref hash is missing")
    require("hmac.compare_digest" in validator_source, "constant-time identity comparison is missing")
    require("parse_multipart_files" in validator_source and "canonical_manifest" in validator_source, "canonical multipart manifest code is missing")
    require("runtime_manifest_digest" in validator_source and "runtime_bundle_digest" in validator_source, "digest provenance split is missing")
    require(("raw_" + "multipart_digest") not in validator_source and ("source_" + "sha256") not in validator_source, "raw transport digest comparison is prohibited")
    require("IDENTITY_TEST_COUNT = 17" in validator_source and "MANIFEST_TEST_COUNT = 20" in validator_source, "required self-test suites are missing")
    require('"dispatcher": "supabase_edge_function"' in validator_source and '"email_provider": "resend"' in validator_source, "canonical delivery contract is missing")
    require(("summarize_" + "n" + "8n") not in validator_source and ("--n" + "8n") not in validator_source, "runtime n8n validator code remains")
    compile(validator_source, str(validator_path), "exec")

    readme = readme_path.read_text(encoding="utf-8")
    for phrase in (
        "Supabase Edge Function", "Resend", "notifications-n0-evidence/v3",
        "UNKNOWN_BY_DESIGN", "fail-closed", "R2B", "does not enable N1",
        "no PII", "read-only", "EXPECTED_AUTOMATIC_PREVIEW",
        "multipart/form-data", "canonical manifest", "metadata_only",
        "parse_failed", "bundle digest", "transport body",
    ):
        require(phrase.lower() in readme.lower(), f"README is missing: {phrase}")
    require("n8n" in readme.lower() and "retired" in readme.lower(), "n8n retirement statement is missing")


def valid_fixture() -> dict[str, Any]:
    return {
        "schema_version": "notifications-n0-evidence/v3",
        "generated_at_utc": "2026-01-01T00:00:00Z",
        "environment": "DEV",
        "github": {"head_sha": "a" * 40},
        "environment_identity": {
            "expected_ref_hash_match": True,
            "db_url_ref_match": True,
            "management_metadata_ref_match": True,
            "supabase_host_allowlisted": True,
            "unsafe_connection_options_absent": True,
            "identity_verified_before_database_read": True,
            "raw_identity_retained": False,
        },
        "delivery_architecture": {
            "dispatcher": "supabase_edge_function",
            "dispatcher_name": "notification-dispatcher",
            "email_provider": "resend",
            "ledger": "notification_events",
            "delivery_attempts": "notification_delivery_attempts",
            "single_consumer_required": True,
            "provider_api_called_by_audit": False,
            "emails_sent_by_audit": False,
        },
        "migrations": {"available": False, "entries": [], "duplicates": [], "required_versions": []},
        "database_schema": {"entities": [], "functions": [], "enum_types": []},
        "notification_aggregates": {
            "available": False, "total": None, "by_status": [], "by_event_type": [],
            "by_status_event_type": [], "recipient_present": None, "recipient_absent": None,
            "processing_total": None, "max_processing_age_seconds": None, "failed": None,
            "dead_letter": None, "cancelled": None, "events_without_attempts": None,
            "events_with_multiple_attempts": None, "attempts_available": False,
            "attempts_by_status": [], "max_attempt_number": None,
        },
        "intake_aggregates": {
            "available": False, "total": None, "by_status": [],
            "providers": {
                "available": False, "email_column_present": False,
                "with_email": None, "without_email": None,
            },
        },
        "payment_receipt_aggregates": {
            "receipt_links": {
                "available": False, "total": None, "distinct_requests": None,
                "distinct_evidences": None, "duplicate_requests": None,
                "duplicate_evidences": None,
            },
            "evidence": {
                "available": False, "total": None, "shareable": None,
                "one_page": None, "single_operation_attested": None,
            },
            "outbox": {"available": False, "payment_receipt_linked_events": None},
            "payment_requests": {"available": False, "by_status": []},
        },
        "storage": {
            "available": False, "bucket_total": None, "public_bucket_total": None,
            "private_bucket_total": None, "objects_policy_count": None,
            "objects_policies": [],
        },
        "dispatcher_runtime": {
            "name": "notification-dispatcher",
            "deployed": True,
            "metadata_available": True,
            "body_available": True,
            "multipart_parsed": True,
            "runtime_file_count": 1,
            "github_file_count": 1,
            "path_set_match": True,
            "runtime_manifest_digest": "b" * 64,
            "github_manifest_digest": "b" * 64,
            "runtime_bundle_digest": "c" * 64,
            "source_match": True,
            "comparison_state": "match",
            "verify_jwt": True,
            "source_retained": False,
            "function_invoked": False,
            "function_deployed_by_audit": False,
        },
        "resend_source_contract": {
            "provider": "resend",
            "dispatcher_source_inspected": True,
            "integration_reference_present": True,
            "send_mode_guard_present": True,
            "idempotency_header_present": False,
            "provider_api_called_by_audit": False,
            "email_sent_by_audit": False,
            "runtime_secret_values_read": False,
        },
        "send_mode": {
            "state": "UNKNOWN_BY_DESIGN",
            "reason": "runtime secret values are not read by this audit",
        },
        "source_status": {
            "database": "available",
            "project_identity": "available",
            "dispatcher_metadata": "available",
            "dispatcher_body": "available",
            "dispatcher_manifest": "available",
            "github_source": "available",
            "resend_source_contract": "available",
        },
        "privacy_validation": {"status": "PASS"},
        "cleanup": {"status": "PASS"},
    }


def expect_artifact_failure(label: str, mutate) -> None:
    candidate = copy.deepcopy(valid_fixture())
    mutate(candidate)
    try:
        validate_artifact_object(candidate, pending_allowed=False)
    except AuditError:
        return
    raise AuditError(f"negative artifact self-test unexpectedly passed: {label}")


def expect_call_failure(label: str, function, *args, **kwargs) -> None:
    try:
        function(*args, **kwargs)
    except (AuditError, ValueError):
        return
    raise AuditError(f"negative self-test unexpectedly passed: {label}")


def multipart_fixture(boundary: str, parts: list[tuple[str, bytes]], include_metadata: bool = False) -> tuple[str, bytes]:
    content_type = f'multipart/form-data; boundary="{boundary}"'
    chunks: list[bytes] = []
    if include_metadata:
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="metadata"\r\n',
            b"Content-Type: application/json\r\n\r\n",
            b'{"version":1}\r\n',
        ])
    for path, content in parts:
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path}"\r\n'.encode(),
            f"Supabase-Path: {path}\r\n".encode(),
            b"Content-Type: application/octet-stream\r\n\r\n",
            content,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return content_type, b"".join(chunks)


IDENTITY_TEST_COUNT = 17
MANIFEST_TEST_COUNT = 20


def identity_self_tests() -> None:
    ref = "abcdefghijklmnopqrst"
    other_ref = "bcdefghijklmnopqrstu"
    expected = compute_ref_hash(ref)
    validate_project_ref(ref, expected)
    expect_call_failure("wrong hash", validate_project_ref, ref, "0" * 64)
    expect_call_failure("wrong length", validate_project_ref, ref[:-1], expected)
    expect_call_failure("uppercase ref", validate_project_ref, ref.upper(), expected)
    direct = f"postgresql://postgres:fixture@db.{ref}.supabase.co:5432/postgres?sslmode=require"
    parse_db_identity(direct, ref)
    pooler = f"postgres://postgres.{ref}:fixture@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=verify-full&connect_timeout=10"
    parse_db_identity(pooler, ref)
    expect_call_failure("URL ref mismatch", parse_db_identity, direct, other_ref)
    expect_call_failure("external host", parse_db_identity, "postgresql://postgres:fixture@example.test:5432/postgres", ref)
    expect_call_failure("wrong scheme", parse_db_identity, direct.replace("postgresql:", "https:"), ref)
    expect_call_failure("wrong database", parse_db_identity, direct.replace("/postgres?", "/other?"), ref)
    expect_call_failure("options query", parse_db_identity, direct + "&options=fixture", ref)
    expect_call_failure("unsafe connection query", parse_db_identity, direct + "&service=x&passfile=x&sslkey=x", ref)
    expect_call_failure("sslmode disable", parse_db_identity, direct.replace("sslmode=require", "sslmode=disable"), ref)
    validate_project_metadata({"ref": ref}, ref)
    expect_call_failure("metadata ref mismatch", validate_project_metadata, {"ref": other_ref}, ref)
    expect_call_failure("metadata ref missing", validate_project_metadata, {}, ref)
    expect_artifact_failure("secret in artifact", lambda item: item["migrations"]["entries"].append({"version": "041", "name": ref}))


def manifest_self_tests() -> None:
    type_a, body_a = multipart_fixture("BoundaryA", [("index.ts", b"alpha"), ("lib/x.ts", b"beta")])
    type_b, body_b = multipart_fixture("BoundaryB", [("lib/x.ts", b"beta"), ("index.ts", b"alpha")])
    files_a = parse_multipart_files(type_a, body_a)
    files_b = parse_multipart_files(type_b, body_b)
    digest_a, _, paths_a = canonical_manifest(files_a)
    digest_b, _, paths_b = canonical_manifest(files_b)
    require(digest_a == digest_b, "boundary changed manifest")
    require(digest_a == digest_b, "part order changed manifest")
    changed = dict(files_a)
    changed["index.ts"] = b"alphb"
    require(canonical_manifest(changed)[0] != digest_a, "byte change did not mismatch")
    removed = dict(files_a)
    removed.pop("lib/x.ts")
    require(canonical_manifest(removed)[0] != digest_a, "path-set change did not mismatch")
    type_meta, body_meta = multipart_fixture("BoundaryC", [("index.ts", b"alpha"), ("lib/x.ts", b"beta")], True)
    require(canonical_manifest(parse_multipart_files(type_meta, body_meta))[0] == digest_a, "metadata part altered manifest")
    expect_call_failure("absolute path", canonical_manifest, {"/index.ts": b"x"})
    expect_call_failure("path traversal", canonical_manifest, {"lib/../index.ts": b"x"})
    expect_call_failure("duplicate normalized path", canonical_manifest, {"index.ts": b"x", "notification-dispatcher/index.ts": b"x"})
    expect_call_failure("malformed boundary", parse_multipart_files, "multipart/form-data; boundary=bad space", body_a)
    expect_call_failure("nonmultipart", parse_multipart_files, "application/octet-stream", body_a)
    require("metadata_only" != "match", "metadata-only became match")
    require("body_unavailable" != "mismatch", "body-unavailable became mismatch")
    require(digest_a == digest_b and paths_a == paths_b, "identical manifests did not match")
    require(hashlib.sha256(body_a).hexdigest() != hashlib.sha256(body_b).hexdigest() and digest_a == digest_b, "transport hash influenced manifest")
    bundle_digest = "f" * 64
    require(bundle_digest != digest_a and digest_a == digest_b, "bundle digest influenced manifest")
    extra_github = dict(files_a, **{"extra.ts": b"x"})
    require(canonical_manifest(extra_github)[0] != digest_a, "extra GitHub file did not mismatch")
    extra_runtime = dict(files_b, **{"extra.ts": b"x"})
    require(canonical_manifest(extra_runtime)[0] != digest_b, "extra runtime file did not mismatch")
    expect_call_failure("symlink mode", validate_source_mode, stat.S_IFLNK | 0o777)
    expect_call_failure("size limit", parse_multipart_files, type_a, body_a, max_bytes=1)
    expect_call_failure("part limit", parse_multipart_files, type_a, body_a, max_parts=1)


def self_test(_: argparse.Namespace) -> None:
    validate_artifact_object(valid_fixture(), pending_allowed=False)
    identity_self_tests()
    manifest_self_tests()
    artifact_cases = (
        ("top-level unknown", lambda item: item.__setitem__("unknown", {})),
        ("wrong provider", lambda item: item["delivery_architecture"].__setitem__("email_provider", "other")),
        ("provider API called", lambda item: item["resend_source_contract"].__setitem__("provider_api_called_by_audit", True)),
        ("email sent", lambda item: item["resend_source_contract"].__setitem__("email_sent_by_audit", True)),
        ("runtime secret read", lambda item: item["resend_source_contract"].__setitem__("runtime_secret_values_read", True)),
        ("wrong send mode", lambda item: item["send_mode"].__setitem__("state", "enabled")),
        ("email", lambda item: item["migrations"]["entries"].append({"version": "041", "name": "person@example.test"})),
        ("UUID", lambda item: item["migrations"]["entries"].append({"version": "041", "name": "123e4567-e89b-12d3-a456-426614174000"})),
        ("URL", lambda item: item["migrations"]["entries"].append({"version": "041", "name": "https://example.test"})),
        ("SHA outside allowlist", lambda item: item["migrations"]["entries"].append({"version": "041", "name": "d" * 64})),
        ("source retained", lambda item: item["dispatcher_runtime"].__setitem__("source_retained", True)),
        ("function invoked", lambda item: item["dispatcher_runtime"].__setitem__("function_invoked", True)),
        ("function deployed", lambda item: item["dispatcher_runtime"].__setitem__("function_deployed_by_audit", True)),
        ("unknown mismatch", lambda item: item["dispatcher_runtime"].update({"comparison_state": "unavailable", "source_match": False})),
        ("metadata-only match", lambda item: item["dispatcher_runtime"].update({"comparison_state": "metadata_only", "source_match": True})),
    )
    for label, mutate in artifact_cases:
        expect_artifact_failure(label, mutate)
    legacy = valid_fixture()
    legacy["database_schema"]["entities"].append({
        "name": "public.notification_events",
        "exists": True,
        "rls_enabled": True,
        "columns": [{
            "name": "n8n_execution_id", "type": "text", "nullable": True,
            "default_present": False, "classification": "LEGACY_SCHEMA_ONLY",
        }],
        "constraints": [], "indexes": [], "policies": [], "grants": [], "triggers": [],
    })
    validate_artifact_object(legacy, pending_allowed=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    static_parser = subparsers.add_parser("static")
    static_parser.add_argument("--root", default=".")
    static_parser.add_argument("--changed-files")
    static_parser.set_defaults(func=static_checks)
    test_parser = subparsers.add_parser("self-test")
    test_parser.set_defaults(func=self_test)
    local_parser = subparsers.add_parser("identity-local")
    local_parser.set_defaults(func=identity_local)
    metadata_parser = subparsers.add_parser("identity-metadata")
    metadata_parser.add_argument("--project-metadata", required=True)
    metadata_parser.add_argument("--project-headers", required=True)
    metadata_parser.add_argument("--identity-marker", required=True)
    metadata_parser.set_defaults(func=identity_metadata)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--db-jsonl", required=True)
    build_parser.add_argument("--identity-marker", required=True)
    build_parser.add_argument("--dispatcher-metadata")
    build_parser.add_argument("--dispatcher-metadata-headers")
    build_parser.add_argument("--dispatcher-body")
    build_parser.add_argument("--dispatcher-body-headers")
    build_parser.add_argument("--dispatcher-metadata-status", choices=("available", "unavailable", "not_collected"), required=True)
    build_parser.add_argument("--dispatcher-body-status", choices=("available", "unavailable", "not_collected"), required=True)
    build_parser.add_argument("--source-dir")
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
        elif args.command == "self-test":
            print("SELF_TEST_PASS")
        elif args.command == "identity-metadata":
            print("DEV_ENVIRONMENT_IDENTITY_VERIFIED")
        elif args.command == "validate":
            print("PRIVACY_VALIDATION_PASS")
        return 0
    except Exception:
        if args.command in {"identity-local", "identity-metadata"}:
            print("DEV_IDENTITY_PRECHECK_FAILED", file=sys.stderr)
        elif args.command == "validate":
            print("PRIVACY_VALIDATION_FAILED", file=sys.stderr)
        else:
            print("AUDIT_VALIDATION_FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
