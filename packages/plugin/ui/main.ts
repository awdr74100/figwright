import { createApp } from 'vue';

import App from './App.vue';

import './style.css';

// Surface any mount/runtime failure directly in the panel — a Figma UI iframe gives no visible
// console, so a thrown setup error would otherwise just render blank.
const showFatal = (msg: string): void => {
  const el = document.getElementById('app');
  if (el === null) return;
  el.textContent = msg;
  el.setAttribute(
    'style',
    'color:#f24822;font:11px/1.5 monospace;padding:8px;margin:0;white-space:pre-wrap;word-break:break-word',
  );
};

globalThis.addEventListener('error', e => showFatal(`error: ${e.message}`));
globalThis.addEventListener('unhandledrejection', e => showFatal(`rejection: ${String(e.reason)}`));

try {
  const app = createApp(App);
  app.config.errorHandler = err =>
    showFatal(err instanceof Error ? (err.stack ?? err.message) : String(err));
  app.mount('#app');
} catch (err) {
  showFatal(err instanceof Error ? (err.stack ?? err.message) : String(err));
}
