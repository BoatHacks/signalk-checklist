# Vendored dependencies

Vendored locally (never loaded from a CDN at runtime), per standing practice
of assuming the browser/server may have flaky or no internet access.

| File          | Package  | Version |
|---------------|----------|---------|
| preact.mjs    | preact   | 10.29.7 |
| hooks.mjs     | preact/hooks | 10.29.7 |
| htm.mjs       | htm      | 3.1.1   |

## Refreshing

```sh
npm install --no-save preact@latest htm@latest
cp node_modules/preact/dist/preact.mjs public/vendor/preact.mjs
cp node_modules/preact/hooks/dist/hooks.mjs public/vendor/hooks.mjs
cp node_modules/htm/dist/htm.mjs public/vendor/htm.mjs
# hooks.mjs imports the bare specifier "preact" — patch it to a relative path:
sed -i 's/from"preact"/from".\/preact.mjs"/' public/vendor/hooks.mjs
```

`htm.mjs` and `preact.mjs` are self-contained (no further imports to patch).
