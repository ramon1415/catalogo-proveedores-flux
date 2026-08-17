from pathlib import Path
import re

from pglast import parse_sql


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260817204224_honor_approved_budget_exceptions_in_layout.sql"
)


source = MIGRATION.read_text(encoding="utf-8")
statements = parse_sql(source)
if len(statements) != 28:
    raise AssertionError(f"expected 28 top-level statements, found {len(statements)}")

function_pattern = re.compile(
    r"create(?: or replace)? function\s+([^\s(]+)"
    r"[\s\S]*?language\s+(sql|plpgsql)"
    r"[\s\S]*?as \$\$([\s\S]*?)\$\$;",
    re.IGNORECASE,
)
sql_functions = [
    (name, body)
    for name, language, body in function_pattern.findall(source)
    if language.lower() == "sql"
]

expected_sql_functions = {
    "public.payment_layout_reference_issue",
    "public.payment_request_has_current_approved_budget_exception",
    "public.approval_batch_payment_layout_candidates_pre_037",
}
actual_sql_functions = {name for name, _ in sql_functions}
if actual_sql_functions != expected_sql_functions:
    raise AssertionError(
        "unexpected SQL function set: "
        f"{sorted(actual_sql_functions)}"
    )

for name, body in sql_functions:
    try:
        parse_sql(body)
    except Exception as error:
        raise AssertionError(f"invalid SQL body for {name}: {error}") from error

print(
    "POSTGRES_PARSE_OK "
    f"statements={len(statements)} "
    f"sql_functions={len(sql_functions)}"
)
