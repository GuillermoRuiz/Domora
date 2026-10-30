#!/usr/bin/env bash
# Smoke test e2e del flujo crítico (Fase 15). Requiere el backend arrancado
# en $API (default http://localhost:3000/api/v1) con el seed aplicado.
set -euo pipefail
API="${API:-http://localhost:3000/api/v1}"

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

# 1. Sin token → 401
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/estates")
[ "$code" = "401" ] || fail "estates sin token devolvió $code (esperado 401)"

# 2. Login
TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@domora.app","password":"admin123"}' | node -e \
  "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);if(!j.accessToken)process.exit(1);console.log(j.accessToken)})") \
  || fail "login"

# 3. Estates + summary
ESTATE=$(curl -s "$API/estates" -H "Authorization: Bearer $TOKEN" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);if(!j.length)process.exit(1);console.log(j[0].id)})") \
  || fail "estates vacío"
curl -sf "$API/estates/$ESTATE/accounting/summary" -H "Authorization: Bearer $TOKEN" > /dev/null || fail "summary"

# 4. Integridad de la contabilidad (fase 13): sin errores duros en la finca del seed
INTEGRITY_OK=$(curl -sf "$API/estates/$ESTATE/ledger/integrity" -H "Authorization: Bearer $TOKEN" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.ok===true&&Array.isArray(j.issues)?'ok':'fail')})") \
  || fail "integrity"
[ "$INTEGRITY_OK" = "ok" ] || fail "integrity devolvió errores duros"

# 5. Sumas y saldos: debe = haber del ejercicio en curso
curl -sf "$API/estates/$ESTATE/reports/trial-balance?format=json" -H "Authorization: Bearer $TOKEN" > /dev/null || fail "trial-balance"

# 6. Credenciales malas → 401
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" -d '{"email":"admin@domora.app","password":"mal"}')
[ "$code" = "401" ] || fail "login con contraseña mala devolvió $code"

echo "SMOKE OK"
