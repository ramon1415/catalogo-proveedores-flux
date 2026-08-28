import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const auth = fs.readFileSync('app/src/lib/auth.tsx', 'utf8')

test('auth stays loading until the initial Supabase session is known', () => {
  assert.match(auth, /const \[sessionReady, setSessionReady\] = useState\(false\)/)
  assert.match(auth, /getSession\(\)\.then\([\s\S]*setSession\(data\.session\)[\s\S]*setSessionReady\(true\)/)
  assert.doesNotMatch(
    auth,
    /getSession\(\)\.then\(\(\{ data \}\) => \{[\s\S]{0,160}setLoading\(false\)/,
  )
})

test('role hydration owns the loading lifecycle before protected routes render', () => {
  assert.match(auth, /if \(!sessionReady\) return[\s\S]*setLoading\(true\)/)
  assert.match(auth, /const r = await resolveRoles\(prof\.id\)[\s\S]*setGroup\(groupFromRoles\(r\)\)/)
  assert.match(auth, /const mem = await resolveMemberships[\s\S]*setMemberships\(mem\)[\s\S]*setLoading\(false\)/)
  assert.match(auth, /\}, \[session, sessionReady\]\)/)
})

test('terminal unauthenticated and profile states release loading explicitly', () => {
  assert.match(auth, /if \(!session\) \{[\s\S]*setMemberships\(\[\]\)[\s\S]*setLoading\(false\)[\s\S]*return/)
  assert.match(auth, /if \(!prof\) \{[\s\S]*setMemberships\(\[\]\)[\s\S]*setLoading\(false\)[\s\S]*return/)
  assert.match(auth, /if \(prof\.active === false\) \{[\s\S]*setGroup\(ROLE_GROUPS\.INACTIVE\)[\s\S]*setLoading\(false\)/)
})
