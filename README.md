(A)rbitrary (R)emote (C)ode (E)xecutor
=======================

[![npm version](https://badge.fury.io/js/arce.svg)](https://badge.fury.io/js/arce)
[![GitHub license](https://img.shields.io/github/license/andreas-schoch/arce.svg)](https://github.com/andreas-schoch/arce/blob/main/LICENSE)
![Coverage Badge](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/andreas-schoch/e7afe8a31c8fde66fc11902f7aad7792/raw/arce__heads_main.json)

An experimental attempt to send arbitrary JavaScript commands to a webapp via a websocket server proxy.

**Should not be used anywhere near production or for any malicious purposes!**

## How is this useful?

This package tries to be a browser-agnostic alternative to tools like puppeteer, playwright, selenium etc.,
which either use the chrome devtools protocol, webdrivers and/or need the browser to be opened with specific args to
work.

Any of the above-mentioned tools should likely be preferred over 'arce', but in scenarios where you have limited
control over how a browser is opened (for example: a webapp shown in a webview embedded in some desktop app) and need to
e2e test a variety of otherwise unsupported browsers, this kind of websocket proxy might work.

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
   npx arce --ssl_cert=example.crt --ssl_key=example.key
   ```

2. Include this script in your index.html to automatically open websocket connection:
   ```html
   <script src="https://localhost:12000/client"></script>
   ```
3. Open https://localhost:12000/public/example-client.html (has the above script already included)
4. Send a POST request to https://localhost:12000/command with the following body:
   ```javascript
   async (waitUntil, capture, done) => {
   capture({foo: 'first'});
    setTimeout(() => document.querySelector('button').click(), 1500);
    // waits for list to be visible
    const list = await waitUntil(() => document.querySelector('ul:not(.hidden)'));
    let i = 0;
    // Scroll to random list item every 0.3s
    const handler = setInterval(() => {
      const randIndex = Math.floor(Math.random() * list.children.length);
      const li = list.children[randIndex];
      capture(li.innerText); // value to be included with the http response
      li.scrollIntoView({ behavior: "smooth", block: "center" });

      if (++i > 10) {
        clearInterval(handler);
        document.body.style.backgroundColor = 'salmon';
        capture({foo: 'last'});
        done();
      }
    }, 300);
   };
   ```
   Which will result in the following response:
   ```json
   {
     "awaitId": "a35339e3-14d6-48ec-bb2b-0cdc7c81f363",
     "captures": [
       {"foo":  "first"},
       "Item 07",
       "Item 01",
       "Item 05",
       "Item 08",
        "...",
        "...",
       {"bar":  "last"}
     ]
   }
   ```
   The code sent within the POST request is run directly on the connected client, so you have pretty much full access
   to the runtime to automate things and make assertions.

## License

MIT
