// SPDX-License-Identifier: MIT OR Apache-2.0
export function createLinkService(scope) {
  const form = scope.querySelector('form');
  const input = scope.querySelector('#link-url');
  const cancelButton = scope.querySelector('#cancel-link');

  return (request, { signal }) => {
    if (signal.aborted) return Promise.resolve({ status:'cancelled' });
    return new Promise(resolve => {
      const listeners = new AbortController();
      const options = { signal:listeners.signal };
      const finish = reply => {
        listeners.abort();
        resolve(reply);
      };
      const cancel = () => finish({ status:'cancelled' });
      signal.addEventListener('abort', cancel, { ...options, once:true });
      form.reset();
      if (request.kind === 'edit') input.value = request.current.href;
      scope.hidden = false;
      form.addEventListener('submit', event => {
        event.preventDefault();
        finish({status:'ok',value:{kind:'set',link:{href:input.value}}});
      }, options);
      cancelButton.addEventListener('click', cancel, options);
      scope.addEventListener('pointerdown', event => {
        if (event.target === scope) event.preventDefault();
      }, options);
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
      }, options);
      input.focus();
    });
  };
}
