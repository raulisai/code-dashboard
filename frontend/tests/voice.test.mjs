import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDictation, insertDictation, microphoneError, recordingType} from '../src/voice.js';

test('Safari puede grabar MP4 aunque no admita WebM', () => {
  assert.equal(recordingType({isTypeSupported: type => type === 'audio/mp4'}), 'audio/mp4');
});

test('se permite al navegador elegir formato si no informa tipos compatibles', () => {
  assert.equal(recordingType({isTypeSupported: () => false}), '');
});

test('insertar dictado conserva el borrador y su código', () => {
  const draft = 'Contexto:\n```js\nconst value = 3;\n```';
  assert.equal(insertDictation(draft, 'Añade un formulario.'), draft + '\n\nAñade un formulario.');
  assert.equal(insertDictation('', 'Una petición.'), 'Una petición.');
});

test('el formato hablado conserva negaciones e instrucciones', () => {
  assert.equal(formatDictation('No elimines ningún archivo.'), 'No elimines ningún archivo.');
  assert.equal(formatDictation('Uno. Nueva línea. Dos. Nuevo párrafo. Tres.'), 'Uno.\nDos.\n\nTres.');
});

test('permiso denegado y dispositivo ocupado tienen acciones comprensibles', () => {
  assert.match(microphoneError({name: 'NotAllowedError'}), /ajustes/);
  assert.match(microphoneError({name: 'NotReadableError'}), /Otra aplicación/);
  assert.match(microphoneError({name: 'NotFoundError'}), /micrófono/);
});
