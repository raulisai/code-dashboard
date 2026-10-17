import {api, post} from './lib.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentPush() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await post('/api/push', {subscription: subscription.toJSON()});
  return subscription;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Instala la app para activar avisos en este dispositivo.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Permite las notificaciones en los ajustes del navegador.');
  const registration = await navigator.serviceWorker.ready;
  const {public_key} = await api('/api/push');
  const raw = atob(public_key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - public_key.length % 4) % 4));
  const key = Uint8Array.from(raw, char => char.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
  try { await post('/api/push', {subscription: subscription.toJSON()}); }
  catch (error) { await subscription.unsubscribe(); throw error; }
}

export async function disablePush() {
  const subscription = await currentPush();
  if (!subscription) return;
  await post('/api/push', {action: 'unsubscribe', endpoint: subscription.endpoint});
  await subscription.unsubscribe();
}
