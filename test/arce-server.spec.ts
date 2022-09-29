import chai, {expect} from 'chai';
import sinonChai from 'sinon-chai';
import {LaunchedChrome, launch} from "chrome-launcher";
import CDP from "chrome-remote-interface";
import {ArceServer} from "../src/arce-server";
import chaiHttp = require("chai-http");
import {waitUntil} from "../src/util/waitUntil";
import {getClientScript} from "../src/arce-client";
import sinon from 'sinon';
import {ArceCommand} from "../src/interfaces";
import {Response} from 'superagent';


chai.use(sinonChai);
chai.use(chaiHttp);
chai.should();

describe(ArceServer.name, () => {
  let server: ArceServer;
  let client: CDP.Client;
  let chrome: LaunchedChrome;

  after(async () => {
    server.stop();
    await chrome.kill();
  });

  it('should verify that ssl cert and key exist before starting server', (done) => {
    const consoleWarnSpy = sinon.spy(console, 'warn');
    _startServer('404.crt', '404.key').then(() => {
      expect(server.sslEnabled).to.eq(false);
      expect(consoleWarnSpy).to.have.been.calledOnceWith('ssl cert or key not found');
      done();
    });
  });

  // TODO test with SSL enabled

  describe('HTTP', () => {
    before(async () => await _startServer());
    afterEach(async () => await client.Page.navigate({url: 'http://localhost:12000'}));

    it('should be able to monitor server status via GET request to root url', (done) => {
      chai.request('http://localhost:12000').get('').end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
    });

    it('should serve the client script from the server', (done) => {
      chai.request('http://localhost:12000').get('/client').end((err, res) => {
        expect(res).to.have.status(200);
        expect(res).to.have.header('content-type', 'application/javascript');
        expect(res).to.have.header('content-length', String(getClientScript('ws://localhost:12000').length));
        done();
      });
    });

    it('should time out when no client connects within 1s to receive command', done => {
      _sendCommand('(waitUntil, capture, done) => {done()}', 0).then(([err, res]) => {
        expect(res).to.have.status(408);
        expect(res).to.have.header('content-length', '0');
        done();
      });
    });

    it('should not time out if client connects shortly after command was sent', done => {
      _sendCommand(`(waitUntil, capture, done) => {capture('late client'); done()}`).then(([err, res]) => {
        expect(res).to.have.status(200);
        expect(res).to.have.header('content-type', 'application/json');
        expect(res.body.captures).to.have.length(1);
        expect(res.body.captures[0]).to.eq('late client');
        done();
      });
      setTimeout(() => client.Page.navigate({url: 'http://localhost:12000/public/example'}), 500);
    });

    it('should capture sync values in order', done => {
      const script = `(waitUntil, capture, done) => {capture('first'), capture('second'); done()}`;
      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand(script)
      .then(([err, res]) => {
        expect(res).to.have.status(200);
        expect(res).to.have.header('content-type', 'application/json');
        expect(res.body.captures).to.have.length(2);
        expect(res.body.captures[0]).to.eq('first');
        expect(res.body.captures[1]).to.eq('second');
        expect(res.body.script).to.eq(script);
        expect(socketSpy).to.have.callCount(1);
        done();
      }))
    });

    it('should capture async non-primitive values in order', done => {
      const script = `\
      async (waitUntil, capture, done) => {
        setTimeout(() => document.querySelector('button').click(), 50);
        const list = await waitUntil(() => document.querySelector('ul:not(.hidden)'));
        capture('first');
        for (const li of list.children) {
            const delayedText = await new Promise(res => setTimeout(() => res(li.innerText), 25));
            capture({ text: delayedText });
        }
        capture('last');
        done();
      }`;

      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand(script)
      .then(([err, res]) => {
        expect(res).to.have.status(200);
        expect(res).to.have.header('content-type', 'application/json');
        expect(res.body.captures).to.have.length(12);
        expect(res.body.captures[0]).to.eq('first');
        expect(res.body.captures[1].text).to.eq('Item 01');
        expect(res.body.captures[2].text).to.eq('Item 02');
        expect(res.body.captures[3].text).to.eq('Item 03');
        expect(res.body.captures[4].text).to.eq('Item 04');
        expect(res.body.captures[5].text).to.eq('Item 05');
        expect(res.body.captures[6].text).to.eq('Item 06');
        expect(res.body.captures[7].text).to.eq('Item 07');
        expect(res.body.captures[8].text).to.eq('Item 08');
        expect(res.body.captures[9].text).to.eq('Item 09');
        expect(res.body.captures[10].text).to.eq('Item 10');
        expect(res.body.captures[11]).to.eq('last');
        expect(res.body.script).to.eq(script);
        expect(socketSpy).to.have.callCount(1);
        done();
      }))
    });

    it('should get previous command by id', done => {
      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand(`(waitUntil, capture, done) => {capture('hello there'); done()}`)
      .then(([err, res]) => {
        const command: ArceCommand = res.body;
        chai.request('http://localhost:12000').get(`/command/${command.awaitId}`).end((err, res) => {
          const commandById = res.body;
          expect(commandById.awaitId).to.eq(command.awaitId);
          expect(commandById.script).to.eq(command.script);
          expect(commandById.captures[0]).to.eq(command.captures[0]);
          expect(socketSpy).to.have.callCount(1);
          done();
        });
      }))
    });

    it('should respond with 404 when command id not found', done => {
      chai.request('http://localhost:12000').get(`/command/non-existing`).end((err, res) => {
        expect(res).to.have.status(404);
        done();
      });
    });

    it('should catch client error in command script and return it', done => {
      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand(`(waitUntil, capture, done) => {throw new Error('hello world'); done();}`)
      .then(([err, res]) => {
        expect(res).to.have.status(400);
        expect(res).to.have.header('content-type', 'application/json');
        expect(res.body.data).to.eq('hello world');
        expect(socketSpy).to.have.callCount(1);
        done();
      }))
    });

    it('should catch rejected promise and return error', done => {
      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand(`async (waitUntil, capture, done) => {await new Promise((res, rej) => rej('hello world')); done();}`)
      .then(([err, res]) => {
        expect(res).to.have.status(400);
        expect(res).to.have.header('content-type', 'application/json');
        expect(res.body.data).to.eq('hello world');
        expect(socketSpy).to.have.callCount(1);
        done();
      }))
    });

    it('should catch command syntax errors before it reaches the client', done => {
      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand(`() => { if }`)
      .then(([err, res]) => {
        expect(res).to.have.status(400);
        expect(res).to.have.header('content-type', 'application/json');
        expect(res.body).to.have.property('syntaxError');
        expect(res.body.syntaxError).to.eq('Unexpected token }');
        expect(socketSpy).to.have.callCount(0);
        done();
      }));
    });

    it('should return 400 bad request if command body is empty', done => {
      client.Page.navigate({url: 'http://localhost:12000/public/example'})
      .then(() => _getSocketSpy())
      .then(socketSpy => _sendCommand('       ')
      .then(([err, res]) => {
        expect(res).to.have.status(400);
        expect(socketSpy).to.have.callCount(0);
        done();
      }));
    });
  });

  const _startServer = async (cert = '', key = '') => {
    server && server.stop();
    chrome && await chrome.kill();

    server = await new ArceServer(cert, key).start();
    chrome = await launch({chromeFlags: ['--disable-gpu', '--headless']});
    client = await CDP({port: chrome.port});
    await Promise.all([client.Network.enable({}), client.Page.enable()]);
    await client.Page.navigate({url: 'http://localhost:12000'});
    await client['Page.loadEventFired']();
  };

  const _getSocketSpy = () => waitUntil(() => {
    // we can only spy on the socket after it was opened in headless chrome and 'openSocketHandler' was fired on server
    if (!server.client.socket) return;
    return sinon.spy(server.client.socket, 'send');
  }, 2000, 10);

  const _sendCommand = (script: string, timeout = 1500): Promise<[unknown, Response]> => new Promise(resolve => {
    chai.request('http://localhost:12000')
    .post('/command')
    .query(timeout ? {timeout} : '')
    .type('application/javascript')
    .send(script)
    .end((err, res) => resolve([err, res]))
  });
});
