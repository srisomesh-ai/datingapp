# demo-site: ready to upload

These are the built files of the **static demo** (no server needed). Upload everything in
this folder, including the hidden `.htaccess`, into your hosting's `public_html`, so that
`index.html` sits directly inside `public_html`.

Do not edit these files by hand. They are generated. To rebuild after code changes:

```bash
npm --prefix client run build:demo && rm -rf demo-site/assets && cp -r client/dist-demo/. demo-site/
```
