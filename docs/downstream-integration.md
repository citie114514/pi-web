# Downstream integration hooks

WebPi ships two extension points for wrappers and other downstream builds — the
Electron shell in `desktop/` is one such consumer. They are browser-side and
independent of Pi agent extensions.

## Session row context menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, WebPi preserves the browser's
native context menu.

## Extension session liveness

Server-side Pi extensions with detached work can prevent automatic idle session
eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive` must
be synchronous, cheap, and scoped to the supplied exact session id or file.
Provider errors fail safe by preserving that session. This lease only affects
automatic idle eviction; explicit shutdown and Stop fallback cleanup still take
precedence.

The registry symbol keeps its upstream `@agegr/pi-web` name on purpose: it is a
cross-process contract, and renaming it would break extensions written against
upstream.
