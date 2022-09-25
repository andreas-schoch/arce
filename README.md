(A)rbitrary (R)emote (C)ode (E)xecutor
=======================
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
3. Send a POST request to https://localhost:12000/command with the following body:
   ```javascript
   async (waitUntil, capture, done) => {
     localStorage.setItem('example', 'example value from localStorage');
     const element1 = await waitUntil(() => document.querySelector('#id1'), 5000);
     const element2 = await waitUntil(() => document.querySelector('#id2'), 5000);
     capture({id1: element1.innerText, id2: element2.innerText});
     capture('hello world string literal');
     capture(location.href);
     capture(localStorage.getItem('example'));
     done(); // http response is sent back once done() is called
   };
   ```
   Which will result in the following response:
   ```json
   {
     "script": "async (waitUntil, capture, done) => {\r\n    localStorage.setItem('example', 'example value from localStorage');\r\n    const element1 = await waitUntil(() => document.querySelector('#id1'), 5000);\r\n    const element2 = await waitUntil(() => document.querySelector('#id2'), 5000);\r\n    capture({id1: element1.innerText, id2: element2.innerText});\r\n    capture('hello world string literal');\r\n    capture(location.href);\r\n    capture(localStorage.getItem('example'));\r\n   done();\r\n};",
     "awaitId": "a35339e3-14d6-48ec-bb2b-0cdc7c81f363",
     "captures": [
       {
         "id1": "innerText of element with id1",
         "id2": "innerText of element with id2"
       },
       "hello world string literal",
       "https://example.com/example",
       "example value from localStorage"
     ]
   }
   ```
   The code sent within the POST request is run directly on the connected client, so you have pretty much full access
   to the runtime to automate things and make assertions.

## License

MIT
