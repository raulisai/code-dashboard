"""Login de scripts: usa el mismo segundo factor que la web, sin bypass."""
import os


async def login(api):
    result = await api('/api/login', {'user': os.environ['MONITOR_USER'], 'password': os.environ['MONITOR_PASSWORD']})
    if result.get('setup_required'):
        raise RuntimeError('Configura primero tu autenticador desde la web. Este script no vincula dispositivos.')
    if result.get('mfa_required'):
        code = os.environ.get('CM_AUTH_CODE', '').strip()
        if not code:
            raise RuntimeError('Falta CM_AUTH_CODE: proporciona un código actual del autenticador o uno de recuperación.')
        await api('/api/login/mfa', {'challenge': result['challenge'], 'code': code})
