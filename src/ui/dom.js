// DOM helpers. Text always goes in through textContent, never as markup.

export function el(tag, props, children) {
  const node = document.createElement(tag);
  const p = props || {};
  for (const key of Object.keys(p)) {
    const value = p[key];
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children || []) {
    if (child) node.append(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(label, onclick, cls) {
  return el('button', { type: 'button', class: cls || 'btn', text: label, onclick });
}

// A modal built on <dialog>. `build(body, close)` fills it in.
export function openDialog(title, build, options) {
  const opts = options || {};
  const dialog = el('dialog', { class: 'dlg', 'aria-label': title, tabindex: '-1' });
  const close = () => dialog.close();
  const head = el('div', { class: 'dlg-head' }, [
    el('h2', { text: title }),
    opts.sticky ? null : button('Close', close, 'btn quiet'),
  ]);
  const body = el('div', { class: 'dlg-body' });
  dialog.append(head, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opts.onClose) opts.onClose();
  });
  if (opts.sticky) dialog.addEventListener('cancel', (e) => e.preventDefault());
  dialog.showModal();
  build(body, close);
  // Unless the builder focused a field, rest focus on the dialog itself.
  if (!body.contains(document.activeElement)) dialog.focus();
  return dialog;
}

export function field(label, input, help) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    input,
    help ? el('span', { class: 'field-help', text: help }) : null,
  ]);
}
