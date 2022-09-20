ARCE - Arbitrary Remote Code Executor
=======================
An experimental attempt to send arbitrary javascript commands to a webapp via a websocket server proxy that the webapp
is listening to.

**Should not be used anywhere near production or for any malicious purposes!**

## How is this useful?

This package tries to be a browser agnostic solution to execute arbitrary js code in browser runtimes.

Existing tools which either use the Chrome Devtools Protocol or open the browser by themselves in a specific way (e.g.
puppeteer, selenium),
won't reliably work across browsers (afaik) or in scenarios where you have limited control over how the browser is
opened.

In my specific case I needed to get a hold of the webview of an office-js addin for e2e testing purposes using appium
and winappdriver.  
Since winappdriver does not support all of appiums capabilities (e.g. context switching, arbitrary code execution),

## Install

```bash
npm install arce
```

or

```bash
yarn add arce
```

## Usage

1. Start websocket server proxy:
   ```shell
   npm run build
   npm run start --ssl_cert=example.crt --ssl_key=example.key
   ```

1. Open Websocket to ARCE server automatically by including this script in the index.html:
   ```html
   <script src="http://localhost:12000/client"></script>
   ```
1. Request to execute a remote command on the connected client:
   ```shell
   $ curl -d "console.log('hello world');return 5 * 5;" -H "Content-Type: application/javascript" -X POST "https://localhost:12000/inject"
   # res: {"awaitId":"some uuid","result": 25}
   ```

## License

MIT
