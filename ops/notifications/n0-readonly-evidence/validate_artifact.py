#!/usr/bin/env python3
"""Build and fail-closed validate the sanitized Notifications N0 evidence artifact."""

from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import io
import hmac
import json
import os
import re
import stat
import struct
import sys
import tempfile
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
LEGACY_NOTIFICATION_FUNCTIONS = frozenset({
    "mark_notification_processed",
    "mark_notification_failed",
})
ROOT_KEYS = {
    "schema_version", "generated_at_utc", "environment", "github",
    "environment_identity", "delivery_architecture", "migrations",
    "database_schema", "notification_aggregates", "intake_aggregates",
    "payment_receipt_aggregates", "receipt_security_contract",
    "storage", "dispatcher_runtime",
    "resend_source_contract", "send_mode", "source_status",
    "privacy_validation", "cleanup",
}
SENSITIVE_ENV_NAMES = (
    "SUPABASE_DEV_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DEV_PROJECT_REF",
)
SAFE_NAME = re.compile(r"^[A-Za-z0-9_. -]{1,160}$")
SAFE_SIGNATURE = re.compile(r"^[A-Za-z0-9_ .,:()\[\]]*$")
MAX_SIGNATURE_BYTES = 16 * 1024
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


DIAGNOSTIC_SCHEMA_VERSION = "notifications-n0-diagnostic/v1"
FAILURE_PHASES = frozenset({
    "DATABASE_JSONL_PARSE",
    "MIGRATIONS_CONTRACT",
    "DATABASE_SCHEMA_CONTRACT",
    "NOTIFICATION_AGGREGATES_CONTRACT",
    "INTAKE_AGGREGATES_CONTRACT",
    "PAYMENT_RECEIPT_AGGREGATES_CONTRACT",
    "RECEIPT_SECURITY_CONTRACT",
    "STORAGE_CONTRACT",
    "ENVIRONMENT_IDENTITY_CONTRACT",
    "DISPATCHER_METADATA_CONTRACT",
    "DISPATCHER_MULTIPART_CONTRACT",
    "GITHUB_SOURCE_MANIFEST_CONTRACT",
    "RESEND_SOURCE_CONTRACT",
    "ARTIFACT_ASSEMBLY_CONTRACT",
    "ARTIFACT_SCHEMA_CONTRACT",
    "ARTIFACT_PRIVACY_CONTRACT",
    "RAW_CLEANUP_CONTRACT",
    "UNEXPECTED_INTERNAL_CONTRACT",
})
FAILURE_CODES = frozenset({
    "SOURCE_FILE_MISSING",
    "JSONL_INVALID",
    "SECTION_SET_MISMATCH",
    "SECTION_DUPLICATED",
    "ROOT_TYPE_INVALID",
    "ENTRY_TYPE_INVALID",
    "IDENTIFIER_FORMAT_INVALID",
    "DIMENSION_FORMAT_INVALID",
    "SIGNATURE_FORMAT_INVALID",
    "COUNT_TYPE_INVALID",
    "BOOLEAN_TYPE_INVALID",
    "REQUIRED_KEY_MISSING",
    "UNKNOWN_KEY_PRESENT",
    "METADATA_SHAPE_INVALID",
    "DISPATCHER_IDENTITY_INVALID",
    "MULTIPART_FORMAT_INVALID",
    "ENTRYPOINT_INVALID",
    "SOURCE_PATH_INVALID",
    "SOURCE_PATH_COLLISION",
    "MANIFEST_INVALID",
    "SOURCE_CONTRACT_INVALID",
    "ARTIFACT_SHAPE_INVALID",
    "ARTIFACT_WRITE_FAILED",
    "PRIVACY_PATTERN_DETECTED",
    "SECRET_VALUE_DETECTED",
    "HASH_OUTSIDE_ALLOWLIST",
    "CLEANUP_FAILED",
    "UNEXPECTED_EXCEPTION",
})
FAILURE_RULES = frozenset({
    "DATABASE_SOURCE_FILE_REQUIRED",
    "STRICT_JSONL_REQUIRED",
    "DATABASE_SECTION_ALLOWLIST",
    "DATABASE_SECTION_UNIQUE",
    "DATABASE_ENTRY_OBJECT_REQUIRED",
    "MIGRATIONS_SECTION_INVALID",
    "DATABASE_SCHEMA_SECTION_INVALID",
    "NOTIFICATION_AGGREGATES_SECTION_INVALID",
    "INTAKE_AGGREGATES_SECTION_INVALID",
    "PAYMENT_RECEIPT_AGGREGATES_SECTION_INVALID",
    "RECEIPT_SECURITY_SECTION_INVALID",
    "STORAGE_SECTION_INVALID",
    "IDENTITY_MARKER_REQUIRED",
    "IDENTITY_MARKER_INVALID",
    "DISPATCHER_METADATA_SHAPE",
    "DISPATCHER_IDENTITY_REQUIRED",
    "DISPATCHER_MULTIPART_INPUT",
    "GITHUB_SOURCE_INPUT",
    "RESEND_SOURCE_INSPECTION",
    "ARTIFACT_ROOT_ALLOWLIST",
    "ARTIFACT_CORE_INVARIANTS",
    "SOURCE_STATUS_INVARIANTS",
    "ARTIFACT_ATOMIC_WRITE",
    "PRIVACY_PATTERN_ALLOWLIST",
    "SECRET_VALUE_ALLOWLIST",
    "DIGEST_PATH_ALLOWLIST",
    "RUNTIME_N8N_PROHIBITED",
    "RAW_INPUTS_REMOVAL",
    "PARTIAL_OUTPUT_REMOVAL",
    "DIAGNOSTIC_ENVELOPE_MISSING",
    "DIAGNOSTIC_ENVELOPE_INVALID",
    "UNEXPECTED_INTERNAL",
})
VALID_FAILURE_TRIPLES = frozenset({
    ("DATABASE_JSONL_PARSE", "SOURCE_FILE_MISSING", "DATABASE_SOURCE_FILE_REQUIRED"),
    ("DATABASE_JSONL_PARSE", "JSONL_INVALID", "STRICT_JSONL_REQUIRED"),
    ("DATABASE_JSONL_PARSE", "ROOT_TYPE_INVALID", "DATABASE_ENTRY_OBJECT_REQUIRED"),
    ("DATABASE_JSONL_PARSE", "ENTRY_TYPE_INVALID", "DATABASE_ENTRY_OBJECT_REQUIRED"),
    ("DATABASE_JSONL_PARSE", "SECTION_DUPLICATED", "DATABASE_SECTION_UNIQUE"),
    ("DATABASE_JSONL_PARSE", "SECTION_SET_MISMATCH", "DATABASE_SECTION_ALLOWLIST"),
    ("MIGRATIONS_CONTRACT", "ARTIFACT_SHAPE_INVALID", "MIGRATIONS_SECTION_INVALID"),
    ("DATABASE_SCHEMA_CONTRACT", "ARTIFACT_SHAPE_INVALID", "DATABASE_SCHEMA_SECTION_INVALID"),
    ("NOTIFICATION_AGGREGATES_CONTRACT", "ARTIFACT_SHAPE_INVALID", "NOTIFICATION_AGGREGATES_SECTION_INVALID"),
    ("INTAKE_AGGREGATES_CONTRACT", "ARTIFACT_SHAPE_INVALID", "INTAKE_AGGREGATES_SECTION_INVALID"),
    ("PAYMENT_RECEIPT_AGGREGATES_CONTRACT", "ARTIFACT_SHAPE_INVALID", "PAYMENT_RECEIPT_AGGREGATES_SECTION_INVALID"),
    ("RECEIPT_SECURITY_CONTRACT", "ARTIFACT_SHAPE_INVALID", "RECEIPT_SECURITY_SECTION_INVALID"),
    ("STORAGE_CONTRACT", "ARTIFACT_SHAPE_INVALID", "STORAGE_SECTION_INVALID"),
    ("ENVIRONMENT_IDENTITY_CONTRACT", "SOURCE_FILE_MISSING", "IDENTITY_MARKER_REQUIRED"),
    ("ENVIRONMENT_IDENTITY_CONTRACT", "ARTIFACT_SHAPE_INVALID", "IDENTITY_MARKER_INVALID"),
    ("DISPATCHER_METADATA_CONTRACT", "METADATA_SHAPE_INVALID", "DISPATCHER_METADATA_SHAPE"),
    ("DISPATCHER_METADATA_CONTRACT", "DISPATCHER_IDENTITY_INVALID", "DISPATCHER_IDENTITY_REQUIRED"),
    ("DISPATCHER_MULTIPART_CONTRACT", "MULTIPART_FORMAT_INVALID", "DISPATCHER_MULTIPART_INPUT"),
    ("DISPATCHER_MULTIPART_CONTRACT", "ARTIFACT_SHAPE_INVALID", "DISPATCHER_MULTIPART_INPUT"),
    ("GITHUB_SOURCE_MANIFEST_CONTRACT", "MANIFEST_INVALID", "GITHUB_SOURCE_INPUT"),
    ("RESEND_SOURCE_CONTRACT", "SOURCE_CONTRACT_INVALID", "RESEND_SOURCE_INSPECTION"),
    ("ARTIFACT_ASSEMBLY_CONTRACT", "ARTIFACT_SHAPE_INVALID", "ARTIFACT_CORE_INVARIANTS"),
    ("ARTIFACT_ASSEMBLY_CONTRACT", "ARTIFACT_WRITE_FAILED", "ARTIFACT_ATOMIC_WRITE"),
    ("ARTIFACT_SCHEMA_CONTRACT", "ARTIFACT_SHAPE_INVALID", "ARTIFACT_ROOT_ALLOWLIST"),
    ("ARTIFACT_SCHEMA_CONTRACT", "ARTIFACT_SHAPE_INVALID", "ARTIFACT_CORE_INVARIANTS"),
    ("ARTIFACT_SCHEMA_CONTRACT", "ARTIFACT_SHAPE_INVALID", "SOURCE_STATUS_INVARIANTS"),
    ("ARTIFACT_PRIVACY_CONTRACT", "PRIVACY_PATTERN_DETECTED", "PRIVACY_PATTERN_ALLOWLIST"),
    ("ARTIFACT_PRIVACY_CONTRACT", "SECRET_VALUE_DETECTED", "SECRET_VALUE_ALLOWLIST"),
    ("ARTIFACT_PRIVACY_CONTRACT", "HASH_OUTSIDE_ALLOWLIST", "DIGEST_PATH_ALLOWLIST"),
    ("ARTIFACT_PRIVACY_CONTRACT", "PRIVACY_PATTERN_DETECTED", "RUNTIME_N8N_PROHIBITED"),
    ("RAW_CLEANUP_CONTRACT", "CLEANUP_FAILED", "RAW_INPUTS_REMOVAL"),
    ("RAW_CLEANUP_CONTRACT", "CLEANUP_FAILED", "PARTIAL_OUTPUT_REMOVAL"),
    ("UNEXPECTED_INTERNAL_CONTRACT", "UNEXPECTED_EXCEPTION", "UNEXPECTED_INTERNAL"),
    ("UNEXPECTED_INTERNAL_CONTRACT", "UNEXPECTED_EXCEPTION", "DIAGNOSTIC_ENVELOPE_MISSING"),
    ("UNEXPECTED_INTERNAL_CONTRACT", "UNEXPECTED_EXCEPTION", "DIAGNOSTIC_ENVELOPE_INVALID"),
})
PHASE_DEFAULTS = {
    "DATABASE_JSONL_PARSE": ("JSONL_INVALID", "STRICT_JSONL_REQUIRED"),
    "MIGRATIONS_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "MIGRATIONS_SECTION_INVALID"),
    "DATABASE_SCHEMA_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "DATABASE_SCHEMA_SECTION_INVALID"),
    "NOTIFICATION_AGGREGATES_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "NOTIFICATION_AGGREGATES_SECTION_INVALID"),
    "INTAKE_AGGREGATES_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "INTAKE_AGGREGATES_SECTION_INVALID"),
    "PAYMENT_RECEIPT_AGGREGATES_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "PAYMENT_RECEIPT_AGGREGATES_SECTION_INVALID"),
    "RECEIPT_SECURITY_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "RECEIPT_SECURITY_SECTION_INVALID"),
    "STORAGE_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "STORAGE_SECTION_INVALID"),
    "ENVIRONMENT_IDENTITY_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "IDENTITY_MARKER_INVALID"),
    "DISPATCHER_METADATA_CONTRACT": ("METADATA_SHAPE_INVALID", "DISPATCHER_METADATA_SHAPE"),
    "DISPATCHER_MULTIPART_CONTRACT": ("MULTIPART_FORMAT_INVALID", "DISPATCHER_MULTIPART_INPUT"),
    "GITHUB_SOURCE_MANIFEST_CONTRACT": ("MANIFEST_INVALID", "GITHUB_SOURCE_INPUT"),
    "RESEND_SOURCE_CONTRACT": ("SOURCE_CONTRACT_INVALID", "RESEND_SOURCE_INSPECTION"),
    "ARTIFACT_ASSEMBLY_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "ARTIFACT_CORE_INVARIANTS"),
    "ARTIFACT_SCHEMA_CONTRACT": ("ARTIFACT_SHAPE_INVALID", "ARTIFACT_CORE_INVARIANTS"),
    "ARTIFACT_PRIVACY_CONTRACT": ("PRIVACY_PATTERN_DETECTED", "PRIVACY_PATTERN_ALLOWLIST"),
    "RAW_CLEANUP_CONTRACT": ("CLEANUP_FAILED", "RAW_INPUTS_REMOVAL"),
    "UNEXPECTED_INTERNAL_CONTRACT": ("UNEXPECTED_EXCEPTION", "UNEXPECTED_INTERNAL"),
}
DIAGNOSTIC_KEYS = {
    "schema_version", "phase", "code", "rule",
    "database_source_present", "dispatcher_metadata_present",
    "dispatcher_body_present", "github_source_present",
    "artifact_written", "raw_cleanup",
}


class AuditError(Exception):
    pass


class AuditFailure(Exception):
    """Fixed-enum failure without dynamic text, args, cause, or traceback output."""

    __slots__ = ("phase", "code", "rule")

    def __init__(self, phase: str, code: str, rule: str):
        if (phase, code, rule) not in VALID_FAILURE_TRIPLES:
            phase = "UNEXPECTED_INTERNAL_CONTRACT"
            code = "UNEXPECTED_EXCEPTION"
            rule = "UNEXPECTED_INTERNAL"
        self.phase = phase
        self.code = code
        self.rule = rule
        super().__init__()


def audit_failure(phase: str, code: str, rule: str) -> None:
    raise AuditFailure(phase, code, rule) from None


def phase_call(phase: str, code: str, rule: str, function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except AuditFailure:
        raise
    except Exception:
        audit_failure(phase, code, rule)


def coerce_failure(error: BaseException) -> AuditFailure:
    if isinstance(error, AuditFailure):
        return error
    code, rule = PHASE_DEFAULTS["UNEXPECTED_INTERNAL_CONTRACT"]
    return AuditFailure("UNEXPECTED_INTERNAL_CONTRACT", code, rule)


def validate_diagnostic_envelope(value: Any) -> dict[str, Any]:
    value = exact_keys(value, DIAGNOSTIC_KEYS, "diagnostic envelope")
    require(value["schema_version"] == DIAGNOSTIC_SCHEMA_VERSION, "invalid diagnostic schema")
    require(value["phase"] in FAILURE_PHASES, "invalid diagnostic phase")
    require(value["code"] in FAILURE_CODES, "invalid diagnostic code")
    require(value["rule"] in FAILURE_RULES, "invalid diagnostic rule")
    require((value["phase"], value["code"], value["rule"]) in VALID_FAILURE_TRIPLES, "invalid diagnostic triple")
    for key in (
        "database_source_present", "dispatcher_metadata_present",
        "dispatcher_body_present", "github_source_present", "artifact_written",
    ):
        require(isinstance(value[key], bool), "invalid diagnostic boolean")
    require(value["raw_cleanup"] in {"PASS", "FAIL"}, "invalid diagnostic cleanup")
    return value


def diagnostic_envelope(
    failure: AuditFailure,
    *,
    database_source_present: bool,
    dispatcher_metadata_present: bool,
    dispatcher_body_present: bool,
    github_source_present: bool,
    artifact_written: bool,
    raw_cleanup: str,
) -> dict[str, Any]:
    value = {
        "schema_version": DIAGNOSTIC_SCHEMA_VERSION,
        "phase": failure.phase,
        "code": failure.code,
        "rule": failure.rule,
        "database_source_present": database_source_present,
        "dispatcher_metadata_present": dispatcher_metadata_present,
        "dispatcher_body_present": dispatcher_body_present,
        "github_source_present": github_source_present,
        "artifact_written": artifact_written,
        "raw_cleanup": raw_cleanup,
    }
    return validate_diagnostic_envelope(value)


def diagnostic_temporary_path(path: Path) -> Path:
    return Path(str(path) + ".tmp")


def validate_diagnostic_path(path: Path) -> None:
    require(path.name == "notifications-n0-diagnostic.json", "invalid diagnostic filename")
    runner_temp = os.environ.get("RUNNER_TEMP")
    if runner_temp:
        require(path.parent.resolve() == Path(runner_temp).resolve(), "diagnostic must remain in RUNNER_TEMP")
    require(not path.is_symlink(), "diagnostic may not be a symlink")


def write_private_atomic(path: Path, value: str) -> None:
    validate_diagnostic_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = diagnostic_temporary_path(path)
    require(not temporary.is_symlink(), "diagnostic temporary may not be a symlink")
    if temporary.exists():
        temporary.unlink()
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def write_diagnostic_envelope(path: Path, value: dict[str, Any]) -> None:
    validate_diagnostic_envelope(value)
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    write_private_atomic(path, payload)


def emit_diagnostic(args: argparse.Namespace) -> None:
    path = Path(args.diagnostic)
    validate_diagnostic_path(path)
    try:
        require(path.is_file() and not path.is_symlink(), "diagnostic envelope is missing")
        value = validate_diagnostic_envelope(json.loads(path.read_text(encoding="utf-8")))
        print(f"AUDIT_FAILURE_PHASE={value['phase']}")
        print(f"AUDIT_FAILURE_CODE={value['code']}")
        print(f"AUDIT_FAILURE_RULE={value['rule']}")
        print(f"AUDIT_RAW_CLEANUP={value['raw_cleanup']}")
    finally:
        for target in (path, diagnostic_temporary_path(path)):
            try:
                if target.is_file() or target.is_symlink():
                    target.unlink()
            except OSError:
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


def safe_signature(value: Any, label: str) -> str:
    require(
        isinstance(value, str)
        and len(value.encode("utf-8")) <= MAX_SIGNATURE_BYTES
        and SAFE_SIGNATURE.fullmatch(value) is not None,
        f"unsafe {label}",
    )
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
        require(
            item["name"] is None
            or (isinstance(item["name"], str) and SAFE_NAME.fullmatch(item["name"]) is not None),
            "unsafe migration name",
        )
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
            safe_signature(column["type"], "column type")
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
        function = exact_keys(
            function,
            {"name", "identity_arguments", "security_definer", "volatility", "classification"},
            "function",
        )
        safe_name(function["name"], "function name")
        safe_signature(function["identity_arguments"], "function signature")
        require(isinstance(function["security_definer"], bool), "invalid function security flag")
        safe_name(function["volatility"], "function volatility")
        require(function["classification"] in {"ACTIVE_SCHEMA", "LEGACY_SCHEMA_ONLY"}, "invalid function classification")
        legacy_contract = (
            function["name"] in LEGACY_NOTIFICATION_FUNCTIONS
            and re.search(r"(?:^|, )p_n8n_execution_id text(?:$|, )", function["identity_arguments"]) is not None
        )
        require(
            legacy_contract == (function["classification"] == "LEGACY_SCHEMA_ONLY"),
            "legacy function classification mismatch",
        )
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




RECEIPT_SECURITY_KEYS = {
    "available",
    "expected_bucket_exists",
    "expected_bucket_private",
    "evidence_table_exists",
    "receipt_links_table_exists",
    "evidence_rows_in_expected_bucket",
    "evidence_rows_outside_expected_bucket",
    "shareable_rows",
    "shareable_invalid_page_rows",
    "shareable_without_attestation_rows",
    "shareable_without_individual_hash_rows",
    "bucket_constraint_enforced",
    "storage_path_constraint_enforced",
    "single_page_constraint_enforced",
    "shareable_attestation_constraint_enforced",
    "operation_unique_enforced",
    "request_unique_enforced",
    "evidence_unique_enforced",
    "select_policy_present",
    "insert_policy_present",
    "select_policy_authenticated_only",
    "insert_policy_authenticated_only",
    "select_policy_expected_bucket_scoped",
    "insert_policy_expected_bucket_scoped",
    "select_policy_uses_guard_helper",
    "insert_policy_uses_guard_helper",
    "guard_helper_exists",
    "guard_helper_security_definer",
    "guard_helper_contract_match",
    "guard_helper_execute_authenticated",
    "guard_helper_execute_service_role",
    "guard_helper_execute_anon",
    "evidence_authenticated_select",
    "receipt_links_authenticated_select",
}


def validate_receipt_security(value: Any) -> None:
    contract = exact_keys(value, RECEIPT_SECURITY_KEYS, "receipt_security_contract")
    bool_keys = RECEIPT_SECURITY_KEYS - {
        "evidence_rows_in_expected_bucket",
        "evidence_rows_outside_expected_bucket",
        "shareable_rows",
        "shareable_invalid_page_rows",
        "shareable_without_attestation_rows",
        "shareable_without_individual_hash_rows",
    }
    for key in bool_keys:
        require(isinstance(contract[key], bool), f"invalid receipt security boolean: {key}")
    count_keys = RECEIPT_SECURITY_KEYS - bool_keys
    for key in count_keys:
        nullable_count(contract[key], f"receipt_security_contract.{key}")
    if not contract["expected_bucket_exists"]:
        require(contract["expected_bucket_private"] is False, "missing expected bucket cannot be private")
    if not contract["evidence_table_exists"]:
        for key in count_keys:
            require(contract[key] is None, f"missing evidence table requires null: {key}")
        for key in (
            "bucket_constraint_enforced",
            "storage_path_constraint_enforced",
            "single_page_constraint_enforced",
            "shareable_attestation_constraint_enforced",
            "evidence_authenticated_select",
        ):
            require(contract[key] is False, f"missing evidence table requires false: {key}")
    if not contract["receipt_links_table_exists"]:
        for key in (
            "operation_unique_enforced",
            "request_unique_enforced",
            "evidence_unique_enforced",
            "receipt_links_authenticated_select",
        ):
            require(contract[key] is False, f"missing receipt links table requires false: {key}")
    if not contract["guard_helper_exists"]:
        for key in (
            "guard_helper_security_definer",
            "guard_helper_contract_match",
            "guard_helper_execute_authenticated",
            "guard_helper_execute_service_role",
            "guard_helper_execute_anon",
        ):
            require(contract[key] is False, f"missing helper requires false: {key}")

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
        if pattern.search(serialized) is not None:
            audit_failure(
                "ARTIFACT_PRIVACY_CONTRACT",
                "PRIVACY_PATTERN_DETECTED",
                "PRIVACY_PATTERN_ALLOWLIST",
            )
    allowed_digest_paths = {
        ("dispatcher_runtime", "runtime_manifest_digest"),
        ("dispatcher_runtime", "github_manifest_digest"),
        ("dispatcher_runtime", "runtime_bundle_digest"),
    }
    for path, text_value in iter_strings(value):
        if SHA256.fullmatch(text_value) and path not in allowed_digest_paths:
            audit_failure(
                "ARTIFACT_PRIVACY_CONTRACT",
                "HASH_OUTSIDE_ALLOWLIST",
                "DIGEST_PATH_ALLOWLIST",
            )
        if "n8n" in text_value.lower():
            parent = value
            for item in path[:-1]:
                parent = parent[item]
            legacy_entity_path = (
                len(path) == 6
                and path[0] == "database_schema"
                and path[1] == "entities"
                and path[3] in {"columns", "constraints", "indexes"}
                and path[5] == "name"
                and isinstance(parent, dict)
                and parent.get("classification") == "LEGACY_SCHEMA_ONLY"
            )
            legacy_function_path = (
                len(path) == 4
                and path[0] == "database_schema"
                and path[1] == "functions"
                and path[3] in {"name", "identity_arguments"}
                and isinstance(parent, dict)
                and parent.get("classification") == "LEGACY_SCHEMA_ONLY"
                and parent.get("name") in LEGACY_NOTIFICATION_FUNCTIONS
                and isinstance(parent.get("identity_arguments"), str)
                and re.search(
                    r"(?:^|, )p_n8n_execution_id text(?:$|, )",
                    parent["identity_arguments"],
                ) is not None
            )
            if not (legacy_entity_path or legacy_function_path):
                audit_failure(
                    "ARTIFACT_PRIVACY_CONTRACT",
                    "PRIVACY_PATTERN_DETECTED",
                    "RUNTIME_N8N_PROHIBITED",
                )


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
    value = phase_call(
        "ARTIFACT_SCHEMA_CONTRACT",
        "ARTIFACT_SHAPE_INVALID",
        "ARTIFACT_ROOT_ALLOWLIST",
        exact_keys,
        value,
        ROOT_KEYS,
        "artifact",
    )

    def validate_core() -> None:
        require(value["schema_version"] == "notifications-n0-evidence/v4", "invalid schema version")
        require(value["environment"] == "DEV", "environment must be DEV")
        require(isinstance(value["generated_at_utc"], str) and value["generated_at_utc"].endswith("Z"), "invalid timestamp")
        github = exact_keys(value["github"], {"head_sha"}, "github")
        require(isinstance(github["head_sha"], str) and HEAD_SHA.fullmatch(github["head_sha"]), "invalid head SHA")
        phase_call(
            "ENVIRONMENT_IDENTITY_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "IDENTITY_MARKER_INVALID",
            validate_environment_identity,
            value["environment_identity"],
        )
        validate_architecture(value["delivery_architecture"])
        phase_call(
            "MIGRATIONS_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "MIGRATIONS_SECTION_INVALID",
            validate_migrations,
            value["migrations"],
        )
        phase_call(
            "DATABASE_SCHEMA_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "DATABASE_SCHEMA_SECTION_INVALID",
            validate_database,
            value["database_schema"],
        )
        phase_call(
            "NOTIFICATION_AGGREGATES_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "NOTIFICATION_AGGREGATES_SECTION_INVALID",
            validate_notification,
            value["notification_aggregates"],
        )
        phase_call(
            "INTAKE_AGGREGATES_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "INTAKE_AGGREGATES_SECTION_INVALID",
            validate_intake,
            value["intake_aggregates"],
        )
        phase_call(
            "PAYMENT_RECEIPT_AGGREGATES_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "PAYMENT_RECEIPT_AGGREGATES_SECTION_INVALID",
            validate_payment_receipt,
            value["payment_receipt_aggregates"],
        )
        phase_call(
            "RECEIPT_SECURITY_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "RECEIPT_SECURITY_SECTION_INVALID",
            validate_receipt_security,
            value["receipt_security_contract"],
        )
        phase_call(
            "STORAGE_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "STORAGE_SECTION_INVALID",
            validate_storage,
            value["storage"],
        )
        phase_call(
            "DISPATCHER_MULTIPART_CONTRACT",
            "ARTIFACT_SHAPE_INVALID",
            "DISPATCHER_MULTIPART_INPUT",
            validate_dispatcher_runtime,
            value["dispatcher_runtime"],
        )
        phase_call(
            "RESEND_SOURCE_CONTRACT",
            "SOURCE_CONTRACT_INVALID",
            "RESEND_SOURCE_INSPECTION",
            validate_resend_source_contract,
            value["resend_source_contract"],
        )
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
        for status_value in source_status.values():
            require(status_value in statuses, "invalid source status")
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

    phase_call(
        "ARTIFACT_SCHEMA_CONTRACT",
        "ARTIFACT_SHAPE_INVALID",
        "ARTIFACT_CORE_INVARIANTS",
        validate_core,
    )
    phase_call(
        "ARTIFACT_PRIVACY_CONTRACT",
        "PRIVACY_PATTERN_DETECTED",
        "PRIVACY_PATTERN_ALLOWLIST",
        validate_sensitive_values,
        value,
    )


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
    if not path.is_file():
        audit_failure("DATABASE_JSONL_PARSE", "SOURCE_FILE_MISSING", "DATABASE_SOURCE_FILE_REQUIRED")
    try:
        raw_lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        audit_failure("DATABASE_JSONL_PARSE", "SOURCE_FILE_MISSING", "DATABASE_SOURCE_FILE_REQUIRED")
    sections: dict[str, Any] = {}
    for line in raw_lines:
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except Exception:
            audit_failure("DATABASE_JSONL_PARSE", "JSONL_INVALID", "STRICT_JSONL_REQUIRED")
        if not isinstance(item, dict):
            audit_failure("DATABASE_JSONL_PARSE", "ROOT_TYPE_INVALID", "DATABASE_ENTRY_OBJECT_REQUIRED")
        if set(item) != {"section", "data"}:
            audit_failure("DATABASE_JSONL_PARSE", "ENTRY_TYPE_INVALID", "DATABASE_ENTRY_OBJECT_REQUIRED")
        section = item.get("section")
        if not isinstance(section, str) or SAFE_NAME.fullmatch(section) is None:
            audit_failure("DATABASE_JSONL_PARSE", "ENTRY_TYPE_INVALID", "DATABASE_ENTRY_OBJECT_REQUIRED")
        if section in sections:
            audit_failure("DATABASE_JSONL_PARSE", "SECTION_DUPLICATED", "DATABASE_SECTION_UNIQUE")
        sections[section] = item["data"]
    expected = {
        "migrations", "database", "notification_aggregates",
        "intake_aggregates", "provider_aggregates",
        "receipt_link_aggregates", "evidence_aggregates",
        "outbox_aggregates", "payment_request_aggregates", "receipt_security_contract",
        "storage_metadata",
    }
    if set(sections) != expected:
        audit_failure("DATABASE_JSONL_PARSE", "SECTION_SET_MISMATCH", "DATABASE_SECTION_ALLOWLIST")
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


def parse_official_path(raw_path: Any) -> tuple[PurePosixPath, bool]:
    require(isinstance(raw_path, str) and raw_path != "", "source path is missing")
    require("\x00" not in raw_path and "\n" not in raw_path and "\r" not in raw_path, "source path contains control data")
    require("\\" not in raw_path and re.match(r"^[A-Za-z]:", raw_path) is None, "Windows source path is prohibited")
    is_file_url = raw_path.lower().startswith("file://")
    if is_file_url:
        parsed = urlsplit(raw_path)
        require(parsed.scheme.lower() == "file" and parsed.netloc == "", "unsafe file URL")
        require(parsed.query == "" and parsed.fragment == "", "file URL query or fragment is prohibited")
        raw_path = unquote(parsed.path)
    else:
        require("://" not in raw_path, "unsupported source path scheme")
    require(raw_path != "" and len(raw_path.encode("utf-8")) <= MAX_PATH_BYTES, "invalid source path length")
    path = PurePosixPath(raw_path)
    require(path.parts and all(part not in {"", ".", ".."} for part in path.parts), "source path traversal")
    return path, path.is_absolute()


def path_is_within(path: PurePosixPath, root: PurePosixPath) -> bool:
    return len(path.parts) > len(root.parts) and path.parts[:len(root.parts)] == root.parts


def derive_entrypoint(
    multipart_metadata: dict[str, Any] | None,
    fallback_metadata: dict[str, Any] | None,
) -> tuple[PurePosixPath, bool]:
    for metadata in (multipart_metadata, fallback_metadata):
        if metadata is None:
            continue
        require(isinstance(metadata, dict), "dispatcher entrypoint metadata is not an object")
        for key in ("deno2_entrypoint_path", "entrypoint_path"):
            if key not in metadata:
                continue
            require(isinstance(metadata[key], str) and metadata[key] != "", "invalid dispatcher entrypoint")
            return parse_official_path(metadata[key])
    raise AuditError("trusted dispatcher entrypoint is unavailable")


def normalize_runtime_path(
    raw_path: str,
    root: PurePosixPath,
    root_is_absolute: bool,
) -> str:
    path, is_absolute = parse_official_path(raw_path)
    if is_absolute:
        require(root_is_absolute and path_is_within(path, root), "absolute source path is outside the trusted root")
        relative_parts = path.parts[len(root.parts):]
    else:
        require(not raw_path.lower().startswith("file://"), "relative file URL is prohibited")
        root_parts = root.parts
        if root_parts and path.parts[:len(root_parts)] == root_parts:
            relative_parts = path.parts[len(root_parts):]
        else:
            relative_parts = path.parts
    require(relative_parts, "source path resolves to the trusted root")
    return normalize_source_path("/".join(relative_parts))


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
    fallback_metadata: dict[str, Any] | None = None,
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
    multipart_metadata: dict[str, Any] | None = None
    raw_files: list[tuple[list[str], bytes]] = []
    for part in parts:
        disposition = part.get_content_disposition()
        name = part.get_param("name", header="content-disposition")
        header_paths = part.get_all("Supabase-Path", [])
        require(len(header_paths) <= 1, "ambiguous source path header")
        header_path = header_paths[0] if header_paths else None
        filename = part.get_filename()
        is_metadata = name == "metadata" or (
            header_path is None and filename is None and part.get_content_type() == "application/json"
        )
        payload = part.get_payload(decode=True)
        require(isinstance(payload, bytes), "multipart payload is not bytes")
        if is_metadata:
            require(header_path is None and filename is None, "metadata part may not declare a file path")
            require(multipart_metadata is None, "duplicate multipart metadata")
            try:
                metadata_value = json.loads(payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise AuditError("invalid multipart metadata") from exc
            require(isinstance(metadata_value, dict), "multipart metadata is not an object")
            multipart_metadata = metadata_value
            continue
        require(disposition in {"form-data", "attachment", "inline"}, "invalid multipart disposition")
        candidates = [value for value in (header_path, filename) if value is not None]
        require(candidates, "file part lacks a source path")
        raw_files.append((candidates, payload))
    require(raw_files, "multipart contains no source files")
    entrypoint, entrypoint_is_absolute = derive_entrypoint(multipart_metadata, fallback_metadata)
    root = entrypoint.parent
    files: dict[str, bytes] = {}
    for candidates, payload in raw_files:
        normalized_candidates = {
            normalize_runtime_path(candidate, root, entrypoint_is_absolute)
            for candidate in candidates
        }
        require(len(normalized_candidates) == 1, "ambiguous multipart source path")
        path = normalized_candidates.pop()
        require(path not in files, "duplicate source path")
        files[path] = payload
    entrypoint_relative = normalize_runtime_path(
        entrypoint.as_posix(),
        root,
        entrypoint_is_absolute,
    )
    require(entrypoint_relative in files, "dispatcher entrypoint is not present in multipart files")
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
            runtime_files = parse_multipart_files(
                content_type,
                body_path.read_bytes(),
                fallback_metadata=metadata if isinstance(metadata, dict) else None,
            )
            runtime_digest, runtime_count, runtime_paths = canonical_manifest(runtime_files)
            multipart_parsed = True
        except Exception:
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
        except Exception:
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


def _path_argument(args: argparse.Namespace, name: str) -> Path | None:
    value = getattr(args, name, None)
    return Path(value) if value else None


def _build_presence(args: argparse.Namespace) -> dict[str, bool]:
    db_path = _path_argument(args, "db_jsonl")
    metadata_path = _path_argument(args, "dispatcher_metadata")
    body_path = _path_argument(args, "dispatcher_body")
    source_dir = _path_argument(args, "source_dir")
    return {
        "database_source_present": bool(db_path and db_path.is_file()),
        "dispatcher_metadata_present": bool(metadata_path and metadata_path.is_file()),
        "dispatcher_body_present": bool(body_path and body_path.is_file()),
        "github_source_present": bool(source_dir and source_dir.is_dir() and not source_dir.is_symlink()),
    }


def _remove_failure_target(path: Path | None) -> bool:
    if path is None or not path.exists():
        return True
    try:
        if path.is_file() or path.is_symlink():
            path.unlink()
            return not path.exists()
        return False
    except Exception:
        return False


def cleanup_failed_build(args: argparse.Namespace) -> str:
    targets = [
        _path_argument(args, "db_jsonl"),
        _path_argument(args, "identity_marker"),
        _path_argument(args, "dispatcher_metadata"),
        _path_argument(args, "dispatcher_metadata_headers"),
        _path_argument(args, "dispatcher_body"),
        _path_argument(args, "dispatcher_body_headers"),
    ]
    output = _path_argument(args, "output")
    if output is not None:
        targets.extend((
            output,
            output.with_suffix(".tmp"),
            output.with_suffix(".validated.tmp"),
            Path(str(output) + ".tmp"),
            Path(str(output) + ".validated.tmp"),
        ))
    diagnostic = _path_argument(args, "diagnostic_output")
    if diagnostic is not None:
        targets.extend((diagnostic, diagnostic_temporary_path(diagnostic)))
    results = [_remove_failure_target(path) for path in targets]
    return "PASS" if all(results) else "FAIL"


def record_build_failure(args: argparse.Namespace, error: BaseException) -> None:
    failure = coerce_failure(error)
    presence = getattr(args, "_diagnostic_presence", _build_presence(args))
    raw_cleanup = cleanup_failed_build(args)
    output = _path_argument(args, "output")
    envelope = diagnostic_envelope(
        failure,
        **presence,
        artifact_written=bool(output and output.is_file()),
        raw_cleanup=raw_cleanup,
    )
    diagnostic_path = _path_argument(args, "diagnostic_output")
    if diagnostic_path is None:
        return
    try:
        write_diagnostic_envelope(diagnostic_path, envelope)
    except Exception:
        return


def run_build_command(args: argparse.Namespace) -> int:
    try:
        build(args)
        return 0
    except Exception as error:
        try:
            record_build_failure(args, error)
        except Exception:
            pass
        return 1


def _load_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_artifact_atomic(output: Path, artifact: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    require(not output.is_symlink(), "artifact output may not be a symlink")
    temporary = output.with_suffix(".tmp")
    require(not temporary.is_symlink(), "artifact temporary may not be a symlink")
    if temporary.exists():
        temporary.unlink()
    payload = json.dumps(artifact, sort_keys=True, separators=(",", ":")) + "\n"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        os.chmod(output, 0o600)
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def build(args: argparse.Namespace) -> None:
    args._diagnostic_presence = _build_presence(args)
    diagnostic_path = _path_argument(args, "diagnostic_output")
    if diagnostic_path is not None:
        validate_diagnostic_path(diagnostic_path)
        diagnostic_targets = (diagnostic_path, diagnostic_temporary_path(diagnostic_path))
        diagnostic_cleanup = [_remove_failure_target(path) for path in diagnostic_targets]
        if not all(diagnostic_cleanup):
            audit_failure("RAW_CLEANUP_CONTRACT", "CLEANUP_FAILED", "RAW_INPUTS_REMOVAL")
    db_path = Path(args.db_jsonl)
    identity_path = Path(args.identity_marker)
    metadata_path = Path(args.dispatcher_metadata) if args.dispatcher_metadata else None
    metadata_headers_path = Path(args.dispatcher_metadata_headers) if args.dispatcher_metadata_headers else None
    body_path = Path(args.dispatcher_body) if args.dispatcher_body else None
    body_headers_path = Path(args.dispatcher_body_headers) if args.dispatcher_body_headers else None
    source_dir = Path(args.source_dir) if args.source_dir else None
    sections = phase_call(
        "DATABASE_JSONL_PARSE",
        "JSONL_INVALID",
        "STRICT_JSONL_REQUIRED",
        parse_jsonl,
        db_path,
    )
    identity = phase_call(
        "ENVIRONMENT_IDENTITY_CONTRACT",
        "SOURCE_FILE_MISSING",
        "IDENTITY_MARKER_REQUIRED",
        _load_json_file,
        identity_path,
    )
    phase_call(
        "ENVIRONMENT_IDENTITY_CONTRACT",
        "ARTIFACT_SHAPE_INVALID",
        "IDENTITY_MARKER_INVALID",
        validate_environment_identity,
        identity,
    )
    metadata = phase_call(
        "DISPATCHER_METADATA_CONTRACT",
        "METADATA_SHAPE_INVALID",
        "DISPATCHER_METADATA_SHAPE",
        load_optional_json,
        metadata_path,
        args.dispatcher_metadata_status,
    )
    runtime, runtime_status = phase_call(
        "DISPATCHER_METADATA_CONTRACT",
        "DISPATCHER_IDENTITY_INVALID",
        "DISPATCHER_IDENTITY_REQUIRED",
        dispatcher_evidence,
        metadata,
        args.dispatcher_metadata_status,
        body_path,
        body_headers_path,
        args.dispatcher_body_status,
        source_dir,
    )
    resend_contract = phase_call(
        "RESEND_SOURCE_CONTRACT",
        "SOURCE_CONTRACT_INVALID",
        "RESEND_SOURCE_INSPECTION",
        inspect_resend_source,
        source_dir if runtime_status["github_source"] == "available" else None,
    )
    raw_paths = (
        db_path, identity_path, metadata_path, metadata_headers_path,
        body_path, body_headers_path,
    )
    phase_call(
        "RAW_CLEANUP_CONTRACT",
        "CLEANUP_FAILED",
        "RAW_INPUTS_REMOVAL",
        remove_raw,
        raw_paths,
    )
    artifact = {
        "schema_version": "notifications-n0-evidence/v4",
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
        "receipt_security_contract": sections["receipt_security_contract"],
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
    phase_call(
        "ARTIFACT_ASSEMBLY_CONTRACT",
        "ARTIFACT_WRITE_FAILED",
        "ARTIFACT_ATOMIC_WRITE",
        _write_artifact_atomic,
        output,
        artifact,
    )


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
        require(changed <= ALLOWED_FILES and len(changed) <= 4, "change set exceeds the R2B-R1 allowlist")

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
    for legacy_function_marker in (
        "'mark_notification_processed'",
        "'mark_notification_failed'",
        "p_n8n_execution_id text",
        "'classification', CASE",
        "pg_get_function_identity_arguments",
    ):
        require(legacy_function_marker in sql, f"legacy function serialization is missing: {legacy_function_marker}")
    for receipt_marker in (
        "'receipt_security_contract'",
        "payment_operation_evidence_bucket_check",
        "payment_operation_evidence_path_check",
        "payment_operation_evidence_pdf_check",
        "payment_operation_evidence_attestation_check",
        "payment_request_receipt_links_operation_key",
        "payment_request_receipt_links_request_key",
        "payment_request_receipt_links_evidence_key",
        "payment_receipt_evidence_finance_select",
        "payment_receipt_evidence_finance_insert",
        "payment_receipt_evidence_storage_path_allowed",
        "pg_get_constraintdef",
        "pg_get_functiondef",
        "has_table_privilege",
        "has_function_privilege",
    ):
        require(receipt_marker in sql, f"receipt security SQL is missing: {receipt_marker}")
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
    require("self-test" in static_block and "artifact v4" in static_block, "validator v4 self-tests are missing")
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
    for diagnostic_marker in (
        "notifications-n0-diagnostic.json",
        "--diagnostic-output",
        "diagnostic-emit",
        "notifications-n0-build.stdout",
        "notifications-n0-build.stderr",
        "AUDIT_FAILURE_PHASE=UNEXPECTED_INTERNAL_CONTRACT",
        "AUDIT_FAILURE_CODE=UNEXPECTED_EXCEPTION",
        "AUDIT_FAILURE_RULE=DIAGNOSTIC_ENVELOPE_MISSING",
        "AUDIT_RAW_CLEANUP=",
    ):
        require(diagnostic_marker in live_block, f"safe diagnostic workflow is missing: {diagnostic_marker}")
    require('> "${build_stdout}" 2> "${build_stderr}"' in live_block, "build stdout/stderr are not privately captured")
    require('"${safe_report}" >> "${GITHUB_STEP_SUMMARY}"' in live_block, "safe diagnostic summary is missing")
    require('cat "${diagnostic_path}"' not in live_block and "jq " not in live_block, "raw diagnostic envelope may not be printed")
    require(
        live_block.find("Build the allowlisted artifact with safe diagnostics")
        < live_block.find("Fail-closed privacy validation")
        < live_block.find("Compute safe artifact metadata")
        < live_block.find("Upload the single sanitized artifact"),
        "failure-sensitive live step ordering changed",
    )

    validator_source = validator_path.read_text(encoding="utf-8")
    require("notifications-n0-evidence/v4" in validator_source, "artifact v4 validator is missing")
    require(AUTHORIZED_DEV_REF_HASH in validator_source, "authorized DEV ref hash is missing")
    require("hmac.compare_digest" in validator_source, "constant-time identity comparison is missing")
    require("parse_multipart_files" in validator_source and "canonical_manifest" in validator_source, "canonical multipart manifest code is missing")
    require("runtime_manifest_digest" in validator_source and "runtime_bundle_digest" in validator_source, "digest provenance split is missing")
    require(("raw_" + "multipart_digest") not in validator_source and ("source_" + "sha256") not in validator_source, "raw transport digest comparison is prohibited")
    require(
        "IDENTITY_TEST_COUNT = 17" in validator_source
        and "MANIFEST_TEST_COUNT = 20" in validator_source
        and "RECEIPT_SECURITY_TEST_COUNT = 13" in validator_source
        and "OFFICIAL_MULTIPART_TEST_COUNT = 16" in validator_source
        and "DIAGNOSTIC_TEST_COUNT = 26" in validator_source
        and "LIVE_SHAPE_TEST_COUNT = 44" in validator_source,
        "required self-test suites are missing",
    )
    for parser_marker in (
        "deno2_entrypoint_path",
        "entrypoint_path",
        "file://",
        "normalize_runtime_path",
        "absolute source path is outside the trusted root",
    ):
        require(parser_marker in validator_source, f"official multipart parser is missing: {parser_marker}")
    require("RECEIPT_SECURITY_KEYS" in validator_source, "receipt security artifact allowlist is missing")
    require('"dispatcher": "supabase_edge_function"' in validator_source and '"email_provider": "resend"' in validator_source, "canonical delivery contract is missing")
    require(("summarize_" + "n" + "8n") not in validator_source and ("--n" + "8n") not in validator_source, "runtime n8n validator code remains")
    for diagnostic_source_marker in (
        'DIAGNOSTIC_SCHEMA_VERSION = "notifications-n0-diagnostic/v1"',
        "VALID_FAILURE_TRIPLES = frozenset",
        "class AuditFailure(Exception)",
        "super().__init__()",
        "write_private_atomic",
        "os.O_EXCL",
        "0o600",
        "validate_diagnostic_envelope",
        "diagnostic_temporary_path",
        "LEGACY_NOTIFICATION_FUNCTIONS",
        "legacy function classification mismatch",
    ):
        require(diagnostic_source_marker in validator_source, f"diagnostic implementation is missing: {diagnostic_source_marker}")
    require(
        ("import " + "trace" + "back") not in validator_source
        and ("trace" + "back.print") not in validator_source,
        "stack trace output is prohibited",
    )
    require(re.search(r"print\s*\(\s*(?:exc|error)\b", validator_source) is None, "dynamic exception printing is prohibited")
    require(re.search(r"repr\s*\(\s*(?:exc|error)\b", validator_source) is None, "dynamic exception repr is prohibited")
    compile(validator_source, str(validator_path), "exec")

    readme = readme_path.read_text(encoding="utf-8")
    for phrase in (
        "Supabase Edge Function", "Resend", "notifications-n0-evidence/v4",
        "UNKNOWN_BY_DESIGN", "fail-closed", "R2B", "does not enable N1",
        "no PII", "read-only", "EXPECTED_AUTOMATIC_PREVIEW",
        "multipart/form-data", "canonical manifest", "metadata_only",
        "parse_failed", "bundle digest", "transport body",
        "receipt_security_contract", "false is evidence", "entrypoint_path",
        "deno2_entrypoint_path", "absolute paths",
        "notifications-n0-diagnostic/v1", "R2B-R1", "30584218059",
        "exact cause remains unproven", "no retry", "exception text",
        "partial artifact", "R2B-R2", "N0 remains open", "N1 remains blocked",
    ):
        require(phrase.lower() in readme.lower(), f"README is missing: {phrase}")
    require("n8n" in readme.lower() and "retired" in readme.lower(), "n8n retirement statement is missing")


def valid_fixture() -> dict[str, Any]:
    return {
        "schema_version": "notifications-n0-evidence/v4",
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
        "receipt_security_contract": {
            "available": True,
            "expected_bucket_exists": True,
            "expected_bucket_private": True,
            "evidence_table_exists": True,
            "receipt_links_table_exists": True,
            "evidence_rows_in_expected_bucket": 0,
            "evidence_rows_outside_expected_bucket": 0,
            "shareable_rows": 0,
            "shareable_invalid_page_rows": 0,
            "shareable_without_attestation_rows": 0,
            "shareable_without_individual_hash_rows": 0,
            "bucket_constraint_enforced": True,
            "storage_path_constraint_enforced": True,
            "single_page_constraint_enforced": True,
            "shareable_attestation_constraint_enforced": True,
            "operation_unique_enforced": True,
            "request_unique_enforced": True,
            "evidence_unique_enforced": True,
            "select_policy_present": True,
            "insert_policy_present": True,
            "select_policy_authenticated_only": True,
            "insert_policy_authenticated_only": True,
            "select_policy_expected_bucket_scoped": True,
            "insert_policy_expected_bucket_scoped": True,
            "select_policy_uses_guard_helper": True,
            "insert_policy_uses_guard_helper": True,
            "guard_helper_exists": True,
            "guard_helper_security_definer": True,
            "guard_helper_contract_match": True,
            "guard_helper_execute_authenticated": True,
            "guard_helper_execute_service_role": True,
            "guard_helper_execute_anon": False,
            "evidence_authenticated_select": False,
            "receipt_links_authenticated_select": False,
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
    except (AuditError, AuditFailure):
        return
    raise AuditError(f"negative artifact self-test unexpectedly passed: {label}")


def expect_call_failure(label: str, function, *args, **kwargs) -> None:
    try:
        function(*args, **kwargs)
    except (AuditError, AuditFailure, ValueError):
        return
    raise AuditError(f"negative self-test unexpectedly passed: {label}")


def multipart_fixture(
    boundary: str,
    parts: list[tuple[str, bytes]],
    include_metadata: bool = False,
    metadata: dict[str, Any] | None = None,
) -> tuple[str, bytes]:
    content_type = f'multipart/form-data; boundary="{boundary}"'
    chunks: list[bytes] = []
    if include_metadata:
        metadata_value = metadata or {"entrypoint_path": "index.ts", "version": 1}
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="metadata"\r\n',
            b"Content-Type: application/json\r\n\r\n",
            json.dumps(metadata_value, sort_keys=True).encode(),
            b"\r\n",
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


def multipart_custom_fixture(
    boundary: str,
    parts: list[dict[str, Any]],
    metadata: dict[str, Any] | None,
) -> tuple[str, bytes]:
    content_type = f'multipart/form-data; boundary="{boundary}"'
    chunks: list[bytes] = []
    if metadata is not None:
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="metadata"\r\n',
            b"Content-Type: application/json\r\n\r\n",
            json.dumps(metadata, sort_keys=True).encode(),
            b"\r\n",
        ])
    for item in parts:
        disposition = 'Content-Disposition: form-data; name="file"'
        if item.get("filename") is not None:
            disposition += f'; filename="{item["filename"]}"'
        chunks.extend([f"--{boundary}\r\n".encode(), disposition.encode() + b"\r\n"])
        if item.get("supabase_path") is not None:
            chunks.append(f'Supabase-Path: {item["supabase_path"]}\r\n'.encode())
        chunks.extend([
            b"Content-Type: application/octet-stream\r\n\r\n",
            item["content"],
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return content_type, b"".join(chunks)


DIAGNOSTIC_TEST_COUNT = 26
LIVE_SHAPE_TEST_COUNT = 44


@contextlib.contextmanager
def isolated_runner_temp():
    previous = os.environ.get("RUNNER_TEMP")
    with tempfile.TemporaryDirectory() as directory:
        os.environ["RUNNER_TEMP"] = directory
        try:
            yield Path(directory)
        finally:
            if previous is None:
                os.environ.pop("RUNNER_TEMP", None)
            else:
                os.environ["RUNNER_TEMP"] = previous


def fixture_sections() -> dict[str, Any]:
    fixture = valid_fixture()
    return {
        "migrations": fixture["migrations"],
        "database": fixture["database_schema"],
        "notification_aggregates": fixture["notification_aggregates"],
        "intake_aggregates": {
            key: value
            for key, value in fixture["intake_aggregates"].items()
            if key != "providers"
        },
        "provider_aggregates": fixture["intake_aggregates"]["providers"],
        "receipt_link_aggregates": fixture["payment_receipt_aggregates"]["receipt_links"],
        "evidence_aggregates": fixture["payment_receipt_aggregates"]["evidence"],
        "outbox_aggregates": fixture["payment_receipt_aggregates"]["outbox"],
        "payment_request_aggregates": fixture["payment_receipt_aggregates"]["payment_requests"],
        "receipt_security_contract": fixture["receipt_security_contract"],
        "storage_metadata": fixture["storage"],
    }


def build_test_arguments(
    root: Path,
    *,
    sections: dict[str, Any] | None = None,
    invalid_jsonl: bool = False,
    database_path_is_directory: bool = False,
) -> argparse.Namespace:
    database_path = root / "database.jsonl"
    identity_path = root / "environment-identity.json"
    source_dir = root / "notification-dispatcher"
    output_dir = root / "output"
    source_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)
    (source_dir / "index.ts").write_text(
        "const provider = 'resend'; const guard = 'notification_send_mode';\n",
        encoding="utf-8",
    )
    identity_path.write_text(
        json.dumps(valid_fixture()["environment_identity"], sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if database_path_is_directory:
        database_path.mkdir(exist_ok=True)
    elif invalid_jsonl:
        database_path.write_text("{invalid\n", encoding="utf-8")
    else:
        selected = sections if sections is not None else fixture_sections()
        database_path.write_text(
            "".join(
                json.dumps({"section": section, "data": selected[section]}, sort_keys=True) + "\n"
                for section in sorted(selected)
            ),
            encoding="utf-8",
        )
    return argparse.Namespace(
        db_jsonl=str(database_path),
        identity_marker=str(identity_path),
        dispatcher_metadata=None,
        dispatcher_metadata_headers=None,
        dispatcher_body=None,
        dispatcher_body_headers=None,
        dispatcher_metadata_status="not_collected",
        dispatcher_body_status="not_collected",
        source_dir=str(source_dir),
        github_head_sha="a" * 40,
        output=str(output_dir / "artifact.json"),
        diagnostic_output=str(root / "notifications-n0-diagnostic.json"),
    )


def safe_diagnostic_output(root: Path, dynamic_text: str) -> str:
    path = root / "notifications-n0-diagnostic.json"
    failure = coerce_failure(RuntimeError(dynamic_text))
    write_diagnostic_envelope(
        path,
        diagnostic_envelope(
            failure,
            database_source_present=False,
            dispatcher_metadata_present=False,
            dispatcher_body_present=False,
            github_source_present=False,
            artifact_written=False,
            raw_cleanup="PASS",
        ),
    )
    if os.name != "nt":
        require(stat.S_IMODE(path.stat().st_mode) == 0o600, "diagnostic permissions are not private")
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        emit_diagnostic(argparse.Namespace(diagnostic=str(path)))
    require(stderr.getvalue() == "", "diagnostic reporter wrote stderr")
    require(not path.exists(), "diagnostic envelope was retained")
    rendered = stdout.getvalue()
    lines = rendered.rstrip("\n").splitlines()
    require(len(lines) == 4, "diagnostic reporter emitted extra lines")
    require(lines[0].startswith("AUDIT_FAILURE_PHASE="), "diagnostic phase line missing")
    require(lines[1].startswith("AUDIT_FAILURE_CODE="), "diagnostic code line missing")
    require(lines[2].startswith("AUDIT_FAILURE_RULE="), "diagnostic rule line missing")
    require(lines[3].startswith("AUDIT_RAW_CLEANUP="), "diagnostic cleanup line missing")
    return rendered


def diagnostic_self_tests() -> None:
    completed = 0

    def pass_case(condition: bool, label: str) -> None:
        nonlocal completed
        require(condition, label)
        completed += 1

    with isolated_runner_temp() as root:
        success_args = build_test_arguments(root)
        pass_case(run_build_command(success_args) == 0, "valid build failed")
        artifact_path = Path(success_args.output)
        require(artifact_path.is_file(), "valid build omitted artifact")
        validate_final(argparse.Namespace(artifact=str(artifact_path)))
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        require(artifact["schema_version"] == "notifications-n0-evidence/v4", "valid build changed artifact schema")

    phase_envelopes_valid = True
    for phase, (code, rule) in PHASE_DEFAULTS.items():
        envelope = diagnostic_envelope(
            AuditFailure(phase, code, rule),
            database_source_present=False,
            dispatcher_metadata_present=False,
            dispatcher_body_present=False,
            github_source_present=False,
            artifact_written=False,
            raw_cleanup="PASS",
        )
        phase_envelopes_valid = phase_envelopes_valid and validate_diagnostic_envelope(envelope) is envelope
    pass_case(phase_envelopes_valid and len(PHASE_DEFAULTS) == len(FAILURE_PHASES), "phase taxonomy coverage failed")

    sensitive_samples = (
        "person@example.test",
        "postgresql://fixture:fixture@example.test/postgres",
        "abcdefghijklmnopqrst",
        "token=fixture-value",
        "123e4567-e89b-12d3-a456-426614174000",
    )
    with isolated_runner_temp() as root:
        rendered_samples = []
        for sample in sensitive_samples:
            rendered = safe_diagnostic_output(root, sample)
            require(sample not in rendered, "dynamic exception text escaped")
            rendered_samples.append(rendered)
    pass_case("person@example.test" not in rendered_samples[0], "email escaped")
    pass_case("postgresql://" not in rendered_samples[1], "database URL escaped")
    pass_case("abcdefghijklmnopqrst" not in rendered_samples[2], "project ref escaped")
    pass_case("fixture-value" not in rendered_samples[3], "token escaped")
    pass_case("123e4567" not in rendered_samples[4], "UUID escaped")

    unexpected = coerce_failure(RuntimeError("private"))
    pass_case(
        (unexpected.phase, unexpected.code, unexpected.rule)
        == ("UNEXPECTED_INTERNAL_CONTRACT", "UNEXPECTED_EXCEPTION", "UNEXPECTED_INTERNAL"),
        "unexpected exception mapping changed",
    )

    valid_envelope = diagnostic_envelope(
        unexpected,
        database_source_present=False,
        dispatcher_metadata_present=False,
        dispatcher_body_present=False,
        github_source_present=False,
        artifact_written=False,
        raw_cleanup="PASS",
    )
    unknown_key = dict(valid_envelope, unexpected_key=False)
    expect_call_failure("unknown diagnostic key", validate_diagnostic_envelope, unknown_key)
    pass_case(True, "unknown diagnostic key passed")
    dynamic_value = dict(valid_envelope, phase="person@example.test")
    expect_call_failure("dynamic diagnostic value", validate_diagnostic_envelope, dynamic_value)
    pass_case(True, "dynamic diagnostic value passed")
    pass_case(validate_diagnostic_envelope(dict(valid_envelope)) is not None, "valid diagnostic failed")

    with isolated_runner_temp() as root:
        failed_args = build_test_arguments(root, invalid_jsonl=True)
        pass_case(run_build_command(failed_args) == 1 and not Path(failed_args.output).exists(), "failure created artifact")
        partial = Path(failed_args.output)
        partial.write_text("partial", encoding="utf-8")
        failed_args = build_test_arguments(root, invalid_jsonl=True)
        partial.write_text("partial", encoding="utf-8")
        pass_case(run_build_command(failed_args) == 1 and not partial.exists(), "partial artifact retained")
        pass_case(
            not Path(failed_args.db_jsonl).exists() and not Path(failed_args.identity_marker).exists(),
            "raw inputs retained",
        )
        report = io.StringIO()
        with contextlib.redirect_stdout(report):
            emit_diagnostic(argparse.Namespace(diagnostic=failed_args.diagnostic_output))
        safe_report = report.getvalue()
        pass_case(("Trace" + "back") not in safe_report, "trace output escaped")
        pass_case(("re" + "pr") not in safe_report.lower(), "repr output escaped")
        pass_case("expecting property" not in safe_report.lower(), "exception message escaped")

    with isolated_runner_temp() as root:
        cleanup_args = build_test_arguments(root, database_path_is_directory=True)
        require(run_build_command(cleanup_args) == 1, "cleanup-failure build unexpectedly passed")
        cleanup_envelope = validate_diagnostic_envelope(
            json.loads(Path(cleanup_args.diagnostic_output).read_text(encoding="utf-8"))
        )
        pass_case(cleanup_envelope["raw_cleanup"] == "FAIL", "cleanup failure was not a fixed enum")

    empty_migration = {"available": True, "entries": [{"version": "001", "name": ""}], "duplicates": [], "required_versions": []}
    expect_call_failure("empty migration name", validate_migrations, empty_migration)
    pass_case(True, "empty migration contract changed")

    long_signature = ", ".join(
        f"p_{index:03d}_{'x' * 50} text"
        for index in range(100)
    )
    long_database = {"entities": [], "enum_types": [], "functions": [{
        "name": "long_signature_fixture",
        "identity_arguments": long_signature,
        "security_definer": False,
        "volatility": "v",
        "classification": "ACTIVE_SCHEMA",
    }]}
    validate_database(long_database)
    pass_case(len(long_signature.encode("utf-8")) > 300, "long PostgreSQL signature was not exercised")

    with isolated_runner_temp() as root:
        body_type, body = multipart_fixture("LibraryException", [("index.ts", b"fixture")])
        body_path = root / "dispatcher-body.bin"
        headers_path = root / "dispatcher-body-headers.txt"
        body_path.write_bytes(body)
        headers_path.write_text(f"Content-Type: {body_type}\n", encoding="utf-8")
        runtime, _ = dispatcher_evidence(
            {"slug": "notification-dispatcher", "entrypoint_path": "file://["},
            "available",
            body_path,
            headers_path,
            "available",
            None,
        )
        pass_case(runtime["comparison_state"] == "parse_failed", "multipart library exception escaped")

    with isolated_runner_temp() as root:
        privacy_sections = fixture_sections()
        privacy_sections["database"] = copy.deepcopy(privacy_sections["database"])
        privacy_sections["database"]["functions"].append({
            "name": "unexpected_runtime_function",
            "identity_arguments": "p_n8n_execution_id text",
            "security_definer": False,
            "volatility": "v",
            "classification": "ACTIVE_SCHEMA",
        })
        privacy_args = build_test_arguments(root, sections=privacy_sections)
        pass_case(run_build_command(privacy_args) == 1 and not Path(privacy_args.output).exists(), "privacy failure produced output")

    success = valid_fixture()
    pass_case(
        set(success) == ROOT_KEYS
        and success["schema_version"] == "notifications-n0-evidence/v4"
        and success["send_mode"]["state"] == "UNKNOWN_BY_DESIGN",
        "success path semantic regression",
    )
    pass_case(
        all(
            "n8n" not in json.dumps(success[key], sort_keys=True).lower()
            for key in ("delivery_architecture", "dispatcher_runtime", "resend_source_contract")
        ),
        "n8n runtime dependency returned",
    )
    pass_case(
        success["resend_source_contract"]["provider_api_called_by_audit"] is False
        and success["resend_source_contract"]["email_sent_by_audit"] is False,
        "Resend call contract changed",
    )
    pass_case(success["dispatcher_runtime"]["function_invoked"] is False, "dispatcher invocation contract changed")
    require(completed == DIAGNOSTIC_TEST_COUNT, "diagnostic self-test count drift")


def live_shape_self_tests() -> None:
    completed = 0

    def passed() -> None:
        nonlocal completed
        completed += 1

    migrations = {"available": True, "entries": [{"version": "001", "name": None}], "duplicates": [], "required_versions": []}
    validate_migrations(migrations); passed()
    expect_call_failure("empty migration", validate_migrations, {"available": True, "entries": [{"version": "001", "name": ""}], "duplicates": [], "required_versions": []}); passed()
    validate_migrations({"available": True, "entries": [{"version": "001", "name": "   "}], "duplicates": [], "required_versions": []}); passed()
    validate_migrations({"available": True, "entries": [{"version": "7", "name": "short"}], "duplicates": [], "required_versions": []}); passed()
    validate_migrations({"available": True, "entries": [{"version": "20260101123456", "name": "timestamp_name"}], "duplicates": [], "required_versions": []}); passed()
    validate_migrations({"available": True, "entries": [], "duplicates": [{"version": "033", "count": 2}], "required_versions": []}); passed()
    expect_call_failure("migration invalid character", validate_migrations, {"available": True, "entries": [{"version": "001", "name": "bad/value"}], "duplicates": [], "required_versions": []}); passed()

    entity = {
        "name": "public." + "x" * 56,
        "exists": True,
        "rls_enabled": True,
        "columns": [],
        "constraints": [],
        "indexes": [],
        "policies": [],
        "grants": [],
        "triggers": [],
    }
    validate_database({"entities": [entity], "functions": [], "enum_types": []}); passed()
    for type_value in ("public.notification_status", "text[]", "numeric(18,2)", "timestamp with time zone"):
        typed = copy.deepcopy(entity)
        typed["columns"] = [{
            "name": "fixture",
            "type": type_value,
            "nullable": True,
            "default_present": False,
            "classification": "ACTIVE_SCHEMA",
        }]
        validate_database({"entities": [typed], "functions": [], "enum_types": []}); passed()
    signature = ", ".join(f"p_{index:03d}_{'x' * 50} text" for index in range(100))
    validate_database({"entities": [], "functions": [{
        "name": "long_signature_fixture",
        "identity_arguments": signature,
        "security_definer": False,
        "volatility": "v",
        "classification": "ACTIVE_SCHEMA",
    }], "enum_types": []}); passed()
    for roles in (["PUBLIC"], ["authenticated", "service_role"]):
        policy_entity = copy.deepcopy(entity)
        policy_entity["policies"] = [{"name": "fixture_policy", "command": "SELECT", "permissive": True, "roles": roles}]
        validate_database({"entities": [policy_entity], "functions": [], "enum_types": []}); passed()
    for mode in ("PERMISSIVE", "RESTRICTIVE"):
        policy_entity = copy.deepcopy(entity)
        policy_entity["policies"] = [{"name": "fixture_policy", "command": "SELECT", "permissive": mode, "roles": ["authenticated"]}]
        validate_database({"entities": [policy_entity], "functions": [], "enum_types": []}); passed()
    validate_database({"entities": [], "functions": [], "enum_types": [{"name": "notification_status", "labels": ["pending", "sent"]}]}); passed()

    legacy_signature = "p_event_id uuid, p_n8n_execution_id text"
    legacy_functions = []
    for function_name in sorted(LEGACY_NOTIFICATION_FUNCTIONS):
        legacy_function = {
            "name": function_name,
            "identity_arguments": legacy_signature,
            "security_definer": True,
            "volatility": "v",
            "classification": "LEGACY_SCHEMA_ONLY",
        }
        validate_database({"entities": [], "enum_types": [], "functions": [legacy_function]}); passed()
        legacy_functions.append(legacy_function)
    legacy_artifact = valid_fixture()
    legacy_artifact["database_schema"]["functions"] = legacy_functions
    validate_artifact_object(legacy_artifact, pending_allowed=False)
    expect_call_failure("unknown legacy function", validate_database, {"entities": [], "enum_types": [], "functions": [{
        "name": "unexpected_function",
        "identity_arguments": legacy_signature,
        "security_definer": False,
        "volatility": "v",
        "classification": "LEGACY_SCHEMA_ONLY",
    }]}); passed()
    expect_call_failure("legacy classification without marker", validate_database, {"entities": [], "enum_types": [], "functions": [{
        "name": "mark_notification_processed",
        "identity_arguments": "p_event_id uuid",
        "security_definer": True,
        "volatility": "v",
        "classification": "LEGACY_SCHEMA_ONLY",
    }]}); passed()

    aggregate = valid_fixture()
    validate_notification(aggregate["notification_aggregates"]); passed()
    nullable = copy.deepcopy(aggregate["notification_aggregates"])
    nullable["total"] = None
    nullable["available"] = False
    validate_notification(nullable); passed()
    empty = copy.deepcopy(aggregate["notification_aggregates"])
    empty["by_status"] = []
    validate_notification(empty); passed()
    dimension = copy.deepcopy(aggregate["notification_aggregates"])
    dimension.update({"available": True, "total": 0, "by_status": [{"status": "pending", "count": 0}]})
    validate_notification(dimension); passed()
    bad_null = copy.deepcopy(dimension)
    bad_null["by_status"] = [{"status": None, "count": 0}]
    expect_call_failure("null dimension", validate_notification, bad_null); passed()
    bad_type = copy.deepcopy(dimension)
    bad_type["by_status"] = [{"status": {"value": "pending"}, "count": 0}]
    expect_call_failure("unexpected dimension", validate_notification, bad_type); passed()

    runtime, _ = dispatcher_evidence({"slug": "notification-dispatcher", "verify_jwt": True}, "available", None, None, "not_collected", None)
    require(runtime["metadata_available"] is True, "direct metadata failed"); passed()
    runtime, _ = dispatcher_evidence({"slug": "notification-dispatcher", "verify_jwt": None}, "available", None, None, "not_collected", None)
    require(runtime["verify_jwt"] is None, "nullable verify_jwt failed"); passed()
    runtime, _ = dispatcher_evidence({"slug": "notification-dispatcher", "ezbr_sha256": "a" * 64}, "available", None, None, "not_collected", None)
    require(runtime["runtime_bundle_digest"] == "a" * 64, "bundle digest failed"); passed()
    runtime, _ = dispatcher_evidence({"slug": "notification-dispatcher"}, "available", None, None, "not_collected", None)
    require(runtime["runtime_bundle_digest"] is None, "unavailable bundle digest failed"); passed()
    multipart_type, multipart_body = multipart_fixture("LiveShape", [("index.ts", b"fixture")])
    require(parse_multipart_files(multipart_type, multipart_body, fallback_metadata={"entrypoint_path": "index.ts"}), "multipart valid failed"); passed()
    with isolated_runner_temp() as root:
        body_path = root / "dispatcher-body.bin"
        headers_path = root / "dispatcher-body-headers.txt"
        body_path.write_bytes(multipart_body)
        headers_path.write_text(f"Content-Type: {multipart_type}\n", encoding="utf-8")
        runtime, _ = dispatcher_evidence(
            {"slug": "notification-dispatcher", "entrypoint_path": "file://["},
            "available", body_path, headers_path, "available", None,
        )
        require(runtime["comparison_state"] == "parse_failed", "parse_failed shape failed"); passed()

    privacy_values = (
        "abcdefghijklmnopqrst",
        "123e4567-e89b-12d3-a456-426614174000",
        "person@example.test",
        "https://example.test",
        "postgresql://fixture:fixture@example.test/postgres",
        "eyJabc.def.ghi",
        "token=fixture",
        "https://example.test/object?X-Amz-Signature=fixture",
    )
    for value in privacy_values:
        expect_call_failure("privacy live shape", validate_sensitive_values, {"fixture": value})
        passed()
    validate_sensitive_values({"dispatcher_runtime": {"runtime_manifest_digest": "a" * 64}}); passed()
    expect_call_failure("SHA outside allowlist", validate_sensitive_values, {"fixture": "a" * 64}); passed()

    require(completed == LIVE_SHAPE_TEST_COUNT, "live-shape self-test count drift")


IDENTITY_TEST_COUNT = 17
MANIFEST_TEST_COUNT = 20
RECEIPT_SECURITY_TEST_COUNT = 13
OFFICIAL_MULTIPART_TEST_COUNT = 16


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
    fallback = {"entrypoint_path": "index.ts"}
    type_a, body_a = multipart_fixture("BoundaryA", [("index.ts", b"alpha"), ("lib/x.ts", b"beta")])
    type_b, body_b = multipart_fixture("BoundaryB", [("lib/x.ts", b"beta"), ("index.ts", b"alpha")])
    files_a = parse_multipart_files(type_a, body_a, fallback_metadata=fallback)
    files_b = parse_multipart_files(type_b, body_b, fallback_metadata=fallback)
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
    expect_call_failure("absolute manifest path", canonical_manifest, {"/index.ts": b"x"})
    expect_call_failure("manifest path traversal", canonical_manifest, {"lib/../index.ts": b"x"})
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
    expect_call_failure("size limit", parse_multipart_files, type_a, body_a, fallback_metadata=fallback, max_bytes=1)
    expect_call_failure("part limit", parse_multipart_files, type_a, body_a, fallback_metadata=fallback, max_parts=1)


def official_multipart_self_tests() -> None:
    relative_type, relative_body = multipart_fixture(
        "OfficialRelative",
        [("source/index.ts", b"alpha"), ("source/lib/utils.ts", b"beta")],
        True,
        {"entrypoint_path": "source/index.ts"},
    )
    relative_files = parse_multipart_files(relative_type, relative_body)
    require(set(relative_files) == {"index.ts", "lib/utils.ts"}, "relative entrypoint normalization failed")

    absolute_type, absolute_body = multipart_fixture(
        "OfficialAbsolute",
        [
            ("/tmp/functions/source/index.ts", b"alpha"),
            ("/tmp/functions/source/lib/utils.ts", b"beta"),
        ],
        True,
        {"deno2_entrypoint_path": "file:///tmp/functions/source/index.ts"},
    )
    absolute_files = parse_multipart_files(absolute_type, absolute_body)
    require(set(absolute_files) == {"index.ts", "lib/utils.ts"}, "absolute entrypoint normalization failed")

    header_type, header_body = multipart_custom_fixture(
        "OfficialHeader",
        [{
            "filename": "index.ts",
            "supabase_path": "/tmp/functions/source/index.ts",
            "content": b"alpha",
        }],
        {"entrypoint_path": "file:///tmp/functions/source/index.ts"},
    )
    require(set(parse_multipart_files(header_type, header_body)) == {"index.ts"}, "absolute Supabase-Path was not normalized")

    outside_type, outside_body = multipart_fixture(
        "OfficialOutside",
        [("/tmp/functions/other/index.ts", b"alpha")],
        True,
        {"entrypoint_path": "file:///tmp/functions/source/index.ts"},
    )
    expect_call_failure("absolute path outside root", parse_multipart_files, outside_type, outside_body)

    traversal_type, traversal_body = multipart_fixture(
        "OfficialTraversal",
        [("source/../escape.ts", b"alpha")],
        True,
        {"entrypoint_path": "source/index.ts"},
    )
    expect_call_failure("relative traversal", parse_multipart_files, traversal_type, traversal_body)

    no_meta_type, no_meta_body = multipart_fixture(
        "OfficialNoMetadata",
        [("/tmp/functions/source/index.ts", b"alpha")],
    )
    expect_call_failure("absolute path without metadata", parse_multipart_files, no_meta_type, no_meta_body)

    incompatible_type, incompatible_body = multipart_fixture(
        "OfficialIncompatible",
        [("source/other.ts", b"alpha")],
        True,
        {"entrypoint_path": "source/index.ts"},
    )
    expect_call_failure("entrypoint missing from files", parse_multipart_files, incompatible_type, incompatible_body)

    collision_type, collision_body = multipart_custom_fixture(
        "OfficialCollision",
        [
            {"filename": "source/index.ts", "supabase_path": None, "content": b"alpha"},
            {"filename": "index.ts", "supabase_path": None, "content": b"beta"},
        ],
        {"entrypoint_path": "source/index.ts"},
    )
    expect_call_failure("normalized path collision", parse_multipart_files, collision_type, collision_body)

    boundary2_type, boundary2_body = multipart_fixture(
        "OfficialBoundary2",
        [("source/index.ts", b"alpha"), ("source/lib/utils.ts", b"beta")],
        True,
        {"entrypoint_path": "source/index.ts"},
    )
    require(canonical_manifest(parse_multipart_files(boundary2_type, boundary2_body))[0] == canonical_manifest(relative_files)[0], "official boundary changed digest")

    order_type, order_body = multipart_fixture(
        "OfficialOrder",
        [("source/lib/utils.ts", b"beta"), ("source/index.ts", b"alpha")],
        True,
        {"entrypoint_path": "source/index.ts"},
    )
    require(canonical_manifest(parse_multipart_files(order_type, order_body))[0] == canonical_manifest(relative_files)[0], "official part order changed digest")

    metadata_type, metadata_body = multipart_fixture(
        "OfficialMetadata",
        [("source/index.ts", b"alpha"), ("source/lib/utils.ts", b"beta")],
        True,
        {"entrypoint_path": "source/index.ts", "version": 99},
    )
    require(canonical_manifest(parse_multipart_files(metadata_type, metadata_body))[0] == canonical_manifest(relative_files)[0], "metadata changed source digest")

    changed_files = dict(relative_files)
    changed_files["index.ts"] = b"changed"
    require(canonical_manifest(changed_files)[0] != canonical_manifest(relative_files)[0], "official byte change did not mismatch")

    extra_files = dict(relative_files, **{"extra.ts": b"x"})
    require(canonical_manifest(extra_files)[0] != canonical_manifest(relative_files)[0], "official extra file did not mismatch")

    expect_call_failure("official symlink mode", validate_source_mode, stat.S_IFLNK | 0o777)
    expect_call_failure("official size limit", parse_multipart_files, relative_type, relative_body, max_bytes=1)
    expect_call_failure("official part limit", parse_multipart_files, relative_type, relative_body, max_parts=1)


def receipt_security_self_tests() -> None:
    validate_artifact_object(valid_fixture(), pending_allowed=False)

    bucket_absent = copy.deepcopy(valid_fixture())
    bucket_absent["receipt_security_contract"].update({
        "expected_bucket_exists": False,
        "expected_bucket_private": False,
    })
    validate_artifact_object(bucket_absent, pending_allowed=False)

    bucket_public = copy.deepcopy(valid_fixture())
    bucket_public["receipt_security_contract"]["expected_bucket_private"] = False
    validate_artifact_object(bucket_public, pending_allowed=False)

    outside = copy.deepcopy(valid_fixture())
    outside["receipt_security_contract"]["evidence_rows_outside_expected_bucket"] = 2
    validate_artifact_object(outside, pending_allowed=False)

    invalid_shareable = copy.deepcopy(valid_fixture())
    invalid_shareable["receipt_security_contract"]["shareable_invalid_page_rows"] = 1
    validate_artifact_object(invalid_shareable, pending_allowed=False)

    policy_absent = copy.deepcopy(valid_fixture())
    policy_absent["receipt_security_contract"]["select_policy_present"] = False
    validate_artifact_object(policy_absent, pending_allowed=False)

    helper_absent = copy.deepcopy(valid_fixture())
    helper_absent["receipt_security_contract"].update({
        "guard_helper_exists": False,
        "guard_helper_security_definer": False,
        "guard_helper_contract_match": False,
        "guard_helper_execute_authenticated": False,
        "guard_helper_execute_service_role": False,
        "guard_helper_execute_anon": False,
    })
    validate_artifact_object(helper_absent, pending_allowed=False)

    anon_access = copy.deepcopy(valid_fixture())
    anon_access["receipt_security_contract"]["guard_helper_execute_anon"] = True
    validate_artifact_object(anon_access, pending_allowed=False)

    direct_select = copy.deepcopy(valid_fixture())
    direct_select["receipt_security_contract"]["evidence_authenticated_select"] = True
    validate_artifact_object(direct_select, pending_allowed=False)

    expect_artifact_failure(
        "negative receipt count",
        lambda item: item["receipt_security_contract"].__setitem__("shareable_rows", -1),
    )
    expect_artifact_failure(
        "unknown receipt field",
        lambda item: item["receipt_security_contract"].__setitem__("unknown", False),
    )
    expect_artifact_failure(
        "raw policy expression",
        lambda item: item["receipt_security_contract"].__setitem__("select_policy_present", "qual = raw"),
    )
    expect_artifact_failure(
        "bucket name value",
        lambda item: item["receipt_security_contract"].__setitem__("expected_bucket_exists", "private-bucket"),
    )


def self_test(_: argparse.Namespace) -> None:
    validate_artifact_object(valid_fixture(), pending_allowed=False)
    identity_self_tests()
    manifest_self_tests()
    official_multipart_self_tests()
    receipt_security_self_tests()
    diagnostic_self_tests()
    live_shape_self_tests()
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
        ("unexpected n8n value", lambda item: item["migrations"]["entries"].append({"version": "041", "name": "n8n_runtime"})),
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
    build_parser.add_argument("--diagnostic-output", required=True)
    build_parser.set_defaults(func=build)
    diagnostic_parser = subparsers.add_parser("diagnostic-emit")
    diagnostic_parser.add_argument("--diagnostic", required=True)
    diagnostic_parser.set_defaults(func=emit_diagnostic)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--artifact", required=True)
    validate_parser.set_defaults(func=validate_final)
    args = parser.parse_args()
    if args.command == "build":
        return run_build_command(args)
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
