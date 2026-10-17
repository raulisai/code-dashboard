/* Segundo factor para las comprobaciones existentes. Nunca configura el factor. */
const codes = (process.env.CM_AUTH_CODES || process.env.CM_AUTH_CODE || '').split(',').map(code=>code.trim()).filter(Boolean);
async function completeMfa(page) {
  await page.locator('.shell, .auth-setup, .auth-code').first().waitFor();
  if (await page.locator('.auth-setup').count()) throw new Error('Configura primero tu autenticador desde la web; esta prueba no vincula dispositivos.');
  if (await page.locator('.auth-code').count()) {
    const code = codes.shift();
    if (!code) throw new Error('Falta CM_AUTH_CODE (o CM_AUTH_CODES para varios navegadores): código actual o de recuperación.');
    if (/^\d{6}$/.test(code)) await page.getByLabel('Código del autenticador', {exact:true}).fill(code);
    else {
      await page.getByRole('button', {name:'He perdido el autenticador', exact:true}).click();
      await page.getByLabel('Código de recuperación', {exact:true}).fill(code);
    }
    await page.getByRole('button', {name:'Entrar', exact:true}).click();
  }
}
module.exports = {completeMfa};
