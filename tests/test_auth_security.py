import base64
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch
import pyotp
from cm import auth, config
from test_core import IsolatedConfig
from http_support import start_client, login_client


class SessionSecurityTests(IsolatedConfig, unittest.TestCase):
    def setUp(self):
        self.isolate()
        self.now = 1792250400
        self.clock = patch.object(auth.time, 'time', side_effect=lambda: self.now)
        self.clock.start(); self.addCleanup(self.clock.stop)

    def enroll(self, remember=True):
        initial = auth.begin_login('tester', 'unit-password', 'ip', 'Browser')
        setup = auth.begin_setup(initial['id'])
        session = auth.confirm_setup(initial['id'], pyotp.TOTP(setup['secret']).at(self.now), 'ip', remember)
        return session, setup['secret']

    def challenge(self, remember=True):
        return auth.begin_login('tester', 'unit-password', 'ip', 'Browser', remember)['challenge']

    def test_password_only_session_is_provisional_and_expires_in_ten_minutes(self):
        session = auth.begin_login('tester', 'unit-password', 'ip', 'Browser', True)
        self.assertTrue(session['setup_required']); self.assertFalse(session['remember'])
        self.assertEqual(session['expires'], self.now + 600)
        self.now += 601
        self.assertFalse(auth.valid_token(session['token']))

    def test_totp_login_remember_180_days_and_absolute_expiry(self):
        first, secret = self.enroll()
        self.now += 30
        challenge = self.challenge()
        session = auth.finish_login(challenge, pyotp.TOTP(secret).at(self.now), 'ip', 'Browser')
        self.assertEqual(session['expires'], self.now + 180 * 86400)
        self.assertTrue(session['remember']); self.assertFalse(session['setup_required'])
        with self.assertRaises(auth.AuthError): auth.finish_login(challenge, first['recovery_codes'][0], 'ip', 'Browser')
        self.now = session['expires']
        self.assertFalse(auth.valid_token(session['token']))

    def test_short_login_does_not_become_persistent(self):
        first, _ = self.enroll()
        session = auth.finish_login(self.challenge(False), first['recovery_codes'][0], 'ip', 'Browser')
        self.assertFalse(session['remember']); self.assertEqual(session['expires'], self.now + 12 * 3600)

    def test_expired_challenge_and_codes_outside_the_clock_window_are_rejected(self):
        session, secret = self.enroll()
        challenge = self.challenge()
        self.now += 301
        with self.assertRaises(auth.AuthError): auth.finish_login(challenge, session['recovery_codes'][0], 'ip', 'Browser')
        with self.assertRaises(auth.AuthError): auth.finish_login(self.challenge(), pyotp.TOTP(secret).at(self.now + 90), 'ip', 'Browser')
        login = auth.finish_login(self.challenge(), pyotp.TOTP(secret).at(self.now + 30), 'ip', 'Browser')
        self.assertTrue(auth.valid_token(login['token']))
        with self.assertRaises(auth.AuthError): auth.finish_login(self.challenge(), pyotp.TOTP(secret).at(self.now), 'ip', 'Browser')

    def test_totp_and_recovery_codes_cannot_be_replayed(self):
        session, secret = self.enroll()
        with self.assertRaises(auth.AuthError): auth.finish_login(self.challenge(), pyotp.TOTP(secret).at(self.now), 'ip', 'Browser')
        code = session['recovery_codes'][0]
        auth.finish_login(self.challenge(), code, 'ip', 'Browser')
        with self.assertRaises(auth.AuthError): auth.finish_login(self.challenge(), code, 'ip', 'Browser')
        self.assertEqual(auth.security_status(session['id'])['recovery_remaining'], 9)

    def test_concurrent_verification_consumes_a_code_only_once(self):
        session, _ = self.enroll()
        challenges = [self.challenge(), self.challenge()]
        def attempt(challenge):
            try: return bool(auth.finish_login(challenge, session['recovery_codes'][0], 'ip', 'Browser'))
            except auth.AuthError: return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(attempt, challenges)), 1)

    def test_rotation_has_bounded_grace_and_does_not_extend_expiry(self):
        session, _ = self.enroll()
        self.now += auth.ROTATE_SECONDS + 1
        rotated = auth.authenticate(session['token'], rotate=True)
        self.assertTrue(rotated['token']); self.assertEqual(rotated['expires'], session['expires'])
        self.assertTrue(auth.valid_token(session['token']))
        self.now += auth.GRACE_SECONDS + 1
        self.assertFalse(auth.valid_token(session['token'])); self.assertTrue(auth.valid_token(rotated['token']))
        auth.revoke_token(rotated['token'])
        self.assertFalse(auth.valid_token(rotated['token'])); self.assertFalse(auth.session_active(session['id']))

    def test_revoking_other_devices_keeps_only_current_session(self):
        session, _ = self.enroll()
        other = auth.finish_login(self.challenge(), session['recovery_codes'][0], 'ip', 'Browser')
        auth.revoke_sessions(session['id'], 'others')
        self.assertTrue(auth.valid_token(session['token'])); self.assertFalse(auth.valid_token(other['token']))

    def test_enrollment_race_and_factor_change_revoke_stale_access(self):
        initial = auth.begin_login('tester', 'unit-password', 'ip', 'Browser')
        competing = auth.begin_login('tester', 'unit-password', 'ip', 'Other')
        one, two = auth.begin_setup(initial['id']), auth.begin_setup(competing['id'])
        session = auth.confirm_setup(initial['id'], pyotp.TOTP(one['secret']).at(self.now), 'ip', True)
        with self.assertRaises(auth.AuthError): auth.confirm_setup(competing['id'], pyotp.TOTP(two['secret']).at(self.now), 'ip', True)
        self.assertFalse(auth.valid_token(competing['token']))
        with self.assertRaises(auth.AuthError): auth.begin_setup(session['id'], 'wrong', session['recovery_codes'][0], 'ip')
        replacement = auth.begin_setup(session['id'], 'unit-password', session['recovery_codes'][0], 'ip')
        self.assertTrue(auth.valid_token(session['token']))
        updated = auth.confirm_setup(session['id'], pyotp.TOTP(replacement['secret']).at(self.now), 'ip', True)
        self.assertFalse(auth.valid_token(session['token'])); self.assertTrue(auth.valid_token(updated['token']))
        with self.assertRaises(auth.AuthError): auth.finish_login(self.challenge(), session['recovery_codes'][1], 'ip', 'Browser')

    def test_database_contains_verifiers_and_encrypted_secret_only(self):
        session, secret = self.enroll()
        content = (config.CONFIG / 'web-auth.sqlite3').read_bytes()
        for private in [session['token'], secret, *session['recovery_codes']]:
            self.assertNotIn(private.encode(), content)
        self.assertEqual((config.CONFIG / 'web-auth.sqlite3').stat().st_mode & 0o777, 0o600)
        self.assertEqual(config.SECRET_FILE.stat().st_mode & 0o777, 0o600)

    def test_challenge_is_bound_to_browser_credentials_and_has_attempt_limit(self):
        session, secret = self.enroll()
        challenge = self.challenge()
        with self.assertRaises(auth.AuthError): auth.finish_login(challenge, session['recovery_codes'][0], 'ip', 'Different')
        bad = '000000' if pyotp.TOTP(secret).at(self.now) != '000000' else '999999'
        for _ in range(6):
            with self.assertRaises(auth.AuthError): auth.finish_login(challenge, bad, 'ip', 'Browser')
        with self.assertRaises(auth.AuthError): auth.finish_login(challenge, session['recovery_codes'][0], 'different-ip', 'Browser')
        challenge = self.challenge()
        with patch.object(config, 'PASSWORD', 'rotated'):
            with self.assertRaises(auth.AuthError): auth.finish_login(challenge, session['recovery_codes'][1], 'ip', 'Browser')
            self.assertFalse(auth.valid_token(session['token']))

    def test_recovery_regeneration_requires_both_factors_and_invalidates_old_codes(self):
        session, _ = self.enroll()
        with self.assertRaises(auth.AuthError): auth.regenerate_recovery(session['id'], 'wrong', session['recovery_codes'][0], 'ip')
        renewed = auth.regenerate_recovery(session['id'], 'unit-password', session['recovery_codes'][0], 'ip')
        self.assertEqual(len(renewed['recovery_codes']), 10)
        with self.assertRaises(auth.AuthError): auth.finish_login(self.challenge(), session['recovery_codes'][1], 'ip', 'Browser')
        self.assertTrue(auth.finish_login(self.challenge(), renewed['recovery_codes'][0], 'ip', 'Browser'))


class SecurityHttpTests(IsolatedConfig, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.isolate(); self.client = await start_client(self)

    async def test_first_login_cannot_access_projects_before_confirming_totp(self):
        response = await self.client.post('/api/login', json={'user': 'tester', 'password': 'unit-password', 'remember': True})
        self.assertTrue((await response.json())['setup_required'])
        self.assertEqual((await self.client.get('/api/state')).status, 403)
        self.assertEqual((await self.client.post('/api/agent/send', json={})).status, 403)
        self.assertTrue((await (await self.client.get('/api/me')).json())['setup_required'])
        self.assertFalse(response.cookies[auth.COOKIE]['max-age'])

    async def test_basic_and_legacy_cookies_cannot_bypass_mfa(self):
        basic = 'Basic ' + base64.b64encode(b'tester:unit-password').decode()
        self.assertEqual((await self.client.get('/api/me', headers={'Authorization': basic})).status, 401)
        self.assertEqual((await self.client.get('/api/me', headers={'Cookie': 'cm_session=old.token.signature'})).status, 401)
        await login_client(self)
        self.client.session.cookie_jar.clear()
        response = await self.client.post('/api/login', json={'user': 'tester', 'password': 'unit-password', 'remember': True})
        self.assertTrue((await response.json())['mfa_required']); self.assertNotIn(auth.COOKIE, response.cookies)
        self.assertEqual((await self.client.get('/api/me', headers={'Authorization': basic})).status, 401)

    async def test_cookie_flags_and_logout_revoke_a_copied_cookie(self):
        response = await login_client(self)
        cookie = response.cookies[auth.COOKIE]
        self.assertTrue(cookie['secure']); self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Strict'); self.assertEqual(cookie['path'], '/')
        self.assertFalse(cookie['domain']); self.assertGreater(int(cookie['max-age']), 179 * 86400)
        token = cookie.value
        await self.client.post('/api/logout')
        self.client.session.cookie_jar.clear()
        replay = await self.client.get('/api/me', headers={'Cookie': f'{auth.COOKIE}={token}'})
        self.assertEqual(replay.status, 401); self.assertEqual(replay.headers['Cache-Control'], 'no-store')

    async def test_security_changes_reject_sibling_and_wrong_scheme_origins(self):
        await login_client(self)
        for origin in ['https://other.devdj.lat', str(self.client.make_url('/')).rstrip('/').replace('http:', 'https:'), 'null']:
            response = await self.client.post('/api/security/recovery', json={}, headers={'Origin': origin})
            self.assertEqual(response.status, 403)
        response = await self.client.post('/api/security/revoke', json={'id':'others'}, headers={'Origin': str(self.client.make_url('/')).rstrip('/')})
        self.assertEqual(response.status, 200)
        data = await (await self.client.get('/api/security')).json()
        self.assertTrue(data['enabled']); self.assertEqual(len(data['sessions']), 1)
        self.assertNotIn('token_hash', data['sessions'][0]); self.assertNotIn('secret', data)
