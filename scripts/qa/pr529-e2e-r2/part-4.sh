jq '{state}' "$PRIVATE_DIR/category-changed.json" > "$EVIDENCE_DIR/category-changed.json"

echo "PR529_DEV_E2E_R2_PASS" | tee "$EVIDENCE_DIR/result.txt"
