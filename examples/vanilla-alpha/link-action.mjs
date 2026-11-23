// SPDX-License-Identifier: MIT OR Apache-2.0
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { defineUiHostAction } from '@klenwriter/editor-ui';

export function createLinkAction(scope) {
  const form = scope.querySelector('form');
  const input = scope.querySelector('#link-url');
  const cancelButton = scope.querySelector('#cancel-link');

  return defineUiHostAction({
    id: 'link',
    label: { ru: 'Ссылка', en: 'Link' },
    scope,
    open({ accept, cancel, signal }) {
      form.reset();
      scope.hidden = false;
      form.addEventListener('submit', event => {
        event.preventDefault();
        accept({ href: input.value });
      }, { signal });
      cancelButton.addEventListener('click', () => cancel(), { signal });
      scope.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        } else if (event.key === 'Tab') {
          const active = scope.ownerDocument.activeElement;
          if (event.shiftKey && active === input) {
            event.preventDefault();
            cancelButton.focus();
          } else if (!event.shiftKey && active === cancelButton) {
            event.preventDefault();
            input.focus();
          }
        }
      }, { signal });
      input.focus();
      return () => { scope.hidden = true; };
    },
    command(_captured, { href }) {
      return kwdjCommand({ kind: 'set_link', href, title: null });
    },
  });
}
