const mode = new URLSearchParams(location.search).get('mode') === 'islands' ? 'islands' : 'single';
const nativeMode = new URLSearchParams(location.search).get('native') === '1';
const editor = document.querySelector('#editor');
const viewport = document.querySelector('.viewport');
const events = [];
let composing = false;
let paintQueued = false;
let wasm = 'pending';
let startedAt = new Date().toISOString();
let sourceFingerprint = 'loading';
let eventSeq = 0;

function point(node, offset) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = element?.closest('[data-block]');
  const path = [];
  for (let n = node; n && n !== block && n !== editor; n = n.parentNode) {
    if (n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
  }
  return { block: block?.dataset.block ?? null, node: node?.nodeName ?? null, path, offset };
}
function selection() {
  const s = getSelection();
  return { text: s?.toString() ?? '', anchor: point(s?.anchorNode, s?.anchorOffset), focus: point(s?.focusNode, s?.focusOffset), collapsed: s?.isCollapsed ?? true };
}
function snapshot() {
  const s = getSelection();
  const rect = viewport.getBoundingClientRect();
  let focusRect = null;
  if (s?.focusNode && editor.contains(s.focusNode)) {
    const range = document.createRange();
    range.setStart(s.focusNode, s.focusOffset); range.collapse(true);
    const r = range.getBoundingClientRect();
    focusRect = { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  return { mode, sourceFingerprint, startedAt, capturedAt: new Date().toISOString(), userAgent: navigator.userAgent,
    nativeMode, viewport: { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }, focusRect,
    label: document.querySelector('#run-label').value, wasm, composing, selection: selection(),
    text: editor.innerText, html: editor.innerHTML, active: document.activeElement?.id,
    events: [...events] };
}
function display() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    // Diagnostics are outside the editing DOM. Never replace nodes during input/composition.
    document.querySelector('#summary').textContent = JSON.stringify({ composing, selection: selection(), active: document.activeElement?.id, events: events.length }, null, 2);
    document.querySelector('#events').textContent = events.slice(-12).map(e => JSON.stringify(e)).join('\n');
    document.querySelector('#trace-json').textContent = JSON.stringify(snapshot(), null, 2);
  });
}
function reset() {
  editor.innerHTML = '<p id="p1" data-block="p1">Alpha <strong>bold</strong> omega.</p><p id="p2" data-block="p2">Bravo café 👩🏽‍💻 é.</p><div class="atom" data-block="card" contenteditable="false" role="group" aria-label="Read-only reference card">Reference card · atomic, not editable</div><blockquote><p id="p3" data-block="p3">Charlie nested paragraph. Русский текст. 日本語.</p></blockquote>';
  editor.removeAttribute('contenteditable');
  editor.removeAttribute('role');
  editor.removeAttribute('aria-label');
  editor.removeAttribute('aria-multiline');
  editor.removeAttribute('tabindex');
  if (mode === 'single') {
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', 'Sample document');
    editor.setAttribute('aria-multiline', 'true');
    editor.tabIndex = 0;
  } else {
    editor.setAttribute('role', 'group');
    editor.setAttribute('aria-label', 'Sample document');
    editor.querySelectorAll('p').forEach((p, i) => {
      p.contentEditable = 'true';
      p.setAttribute('role', 'textbox');
      p.setAttribute('aria-label', `Paragraph ${i + 1}`);
      p.setAttribute('aria-multiline', 'true');
      p.tabIndex = 0;
    });
  }
  events.length = 0;
  eventSeq = 0;
  composing = false;
  startedAt = new Date().toISOString();
  display();
}
for (const type of ['keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend','focusin','focusout','copy','cut','paste']) {
  editor.addEventListener(type, e => {
    if (type === 'compositionstart') composing = true;
    if (type === 'compositionend') composing = false;
    events.push({ seq: ++eventSeq, t: performance.now(), type, trusted: e.isTrusted, defaultPrevented: e.defaultPrevented, key: e.key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, inputType: e.inputType, data: e.data, isComposing: e.isComposing, cancelable: e.cancelable,
      target: e.target.id, selection: selection(), text: editor.innerText });
    if (events.length > 3000) events.shift();
    display();
  });
}
document.addEventListener('selectionchange', e => {
  if (editor.contains(getSelection()?.anchorNode)) {
    events.push({ seq: ++eventSeq, t: performance.now(), type: 'selectionchange', trusted: e.isTrusted, selection: selection(), active: document.activeElement?.id });
    if (events.length > 3000) events.shift();
  }
  display();
});
viewport.addEventListener('scroll', e => {
  events.push({ seq: ++eventSeq, t: performance.now(), type: 'scroll', trusted: e.isTrusted, scrollTop: viewport.scrollTop, selection: selection() });
  if (events.length > 3000) events.shift();
  display();
});
// Keep copied document text out of native Find. Recording and downloads continue.
if (nativeMode) {
  document.querySelector('#diagnostics').hidden = true;
  document.querySelector('#native-controls').hidden = false;
  for (const id of ['single-link', 'islands-link']) {
    document.querySelector(`#${id}`).href += '&native=1';
  }
}
document.querySelector('#reset').addEventListener('click', reset);
document.querySelector('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `osr-58-${mode}-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector('#mode-heading').textContent = mode === 'single' ? 'A · Single editing host' : 'B · Separate block fields';
document.querySelector(`#${mode}-link`).setAttribute('aria-current', 'page');
// Observation-only test seam; no helper changes selection or handles editor commands.
({ sourceFingerprint } = await (await fetch('/manifest.json')).json());
window.spike = { snapshot };
reset();
try {
  await WebAssembly.instantiateStreaming(fetch('/probe.wasm'));
  wasm = 'allowed';
} catch (error) { wasm = `failed: ${error.message}`; }
document.querySelector('#wasm-status').textContent = `WASM CSP probe: ${wasm} (empty module; no editor core)`;
display();
