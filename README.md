ARCE - Arbitrary Remote Code Executor
=======================
An experimental attempt to send arbitrary javascript commands to a webapp via a websocket server proxy that the webapp is listening to.

**Should not be used anywhere near production or for any malicious purposes!**


## How is this useful?
This package tries to be a browser agnostic solution to execute arbitrary js code in browser runtimes.

Existing tools which either use the Chrome Devtools Protocol or open the browser by themselves in a specific way (e.g. puppeteer, selenium),
won't reliably work across browsers (afaik) or in scenarios where you have limited control over how the browser is opened.

In my specific case I needed to get a hold of the webview of an office-js addin for e2e testing purposes using appium and winappdriver.  
Since winappdriver does not support all of appiums capabilities (e.g. context switching, arbitrary code execution),
I tried implementing something that would allow me to do just that.


## Install
```bash
npm install arce
```
or
```bash
yarn add arce
```

## Usage
1.  Start websocket server proxy:
    ```shell
    # currently only way to start server using the repo (no ssl, port 9001 hardcoded)
    npm run server
    
    # In the future something like this will also be possible:
    npx arce start-server --port 9001 --ssl-key 'key.pem' --ssl-cert 'cert.pem'
    
    # as well as programmatically in code
    ```
    
1.  Connect the client to the websocket server:
    ```typescript
    import ARCE from 'arce';
    
    const arce = new ARCE('wss://localhost:9001');
    arce.startClientListener();
    ```
1.  Request to execute a remote command on the connected client:
    ```shell
    $ curl -d $'{"code":"console.log(\'hello world\');return location.href"}' -H "Content-Type: application/json" -X POST "https://localhost:9001/command"
    # res: {"id":"-JGXKbp4","result":"http://localhost:4200/my-example-webapp"}
    ```

## License
MIT
