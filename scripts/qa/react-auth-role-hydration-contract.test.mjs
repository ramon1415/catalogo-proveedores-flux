import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const auth = fs.readFileSync('app/src/lib/auth.tsx', 'utf8')

test('auth stays loading until the initial Supabase session is known', () => {
  assert.match(auth, /const \[sessionReady, setSessionReady\] = useState\(false\)/)
  assert.match(
    auth,
    /getSession\(\)\.then\([\s\S]*setSession\(\(current\) => sameAuthSession\(current, data\.session\) \? current : data\.session\)[\s\S]*setSessionReady\(true\)/,
  )
  assert.doesNotMatch(
    auth,
    /getSession\(\)\.then\(\(\{ data \}\) => \{[\s\S]{0,160}setLoading\(false\)/,
  )
})

test('role hydration owns the loading lifecycle before protected routes render', () => {
  assert.match(auth, /if \(!sessionReady\) return[\s\S]*setLoading\(true\)/)
  assert.match(auth, /const r = await resolveRoles\(prof\.id\)[\s\S]*setGlobalRoles\(r\)/)
  assert.match(auth, /const mem = await resolveMemberships[\s\S]*setMemberships\(mem\)[\s\S]*setLoading\(false\)/)
  assert.match(auth, /const effectiveMembership = useMemo[\s\S]*const group = [\s\S]*groupFromRoles\(roles\)/)
  assert.match(auth, /\}, \[session\?\.user\.id, sessionReady\]\)/)
})

test('same-user auth events do not restart authorization hydration or remount legacy frames', () => {
  assert.match(auth, /function sameAuthSession\(current: Session \| null, next: Session \| null\): boolean/)
  assert.match(auth, /current\.user\.id === next\.user\.id && current\.access_token === next\.access_token/)
  assert.match(auth, /setSession\(\(current\) => sameAuthSession\(current, data\.session\) \? current : data\.session\)/)
  assert.match(auth, /setSession\(\(current\) => sameAuthSession\(current, s\) \? current : s\)/)
  assert.doesNotMatch(auth, /\}, \[session, sessionReady\]\)/)
})

test('terminal unauthenticated and profile states release loading explicitly', () => {
  assert.match(auth, /if \(!session\) \{[\s\S]*setMemberships\(\[\]\)[\s\S]*setLoading\(false\)[\s\S]*return/)
  assert.match(auth, /if \(!prof\) \{[\s\S]*setMemberships\(\[\]\)[\s\S]*setLoading\(false\)[\s\S]*return/)
  assert.match(auth, /if \(prof\.active === false\) \{[\s\S]*setGlobalRoles\(\[\]\)[\s\S]*setLoading\(false\)/)
  assert.match(auth, /profile\?\.active === false \? ROLE_GROUPS\.INACTIVE/)
})
