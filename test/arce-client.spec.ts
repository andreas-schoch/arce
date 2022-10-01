import chai, {expect} from 'chai';
import sinonChai from 'sinon-chai';
import {ArceServer} from "../src/arce-server";
import chaiHttp = require("chai-http");
import {ArceClientToServerMessage, ArceServerToClientMessage} from "../src/interfaces";
import {ArceClient} from "../src/arce-client";
import sinon from 'sinon';


chai.use(sinonChai);
chai.use(chaiHttp);
chai.should();

describe(ArceServer.name, () => {
  it('should process sync command from server', done => {
    const mockSocket = new WebSocketStub();
    const client = new ArceClient('ws://localhost:12000', mockSocket as unknown as WebSocket);
    const clientSendSpy = sinon.spy(client, 'send');

    mockSocket.triggerOnopen();
    const message: ArceServerToClientMessage = {script: `(waitUntil, capture, done) => {capture('hello'); done()}`, awaitId: 'a'};
    const evt = new MessageEvent('message', {data: JSON.stringify(message)})
    mockSocket.triggerOnmessage(evt);
    mockSocket.triggerOnclose();

    setTimeout(() => {
      expect(clientSendSpy).callCount(2);
      const firstMessage: ArceClientToServerMessage = clientSendSpy.getCall(0).firstArg;
      expect(firstMessage.type).to.eq('capture');
      expect(firstMessage.data).to.eq('hello');
      const secondMessage: ArceClientToServerMessage = clientSendSpy.getCall(1).firstArg;
      expect(secondMessage.type).to.eq('done');
      expect(secondMessage.data).to.eq(null);
      done();
    }, 200);
  });

  it('should process async command from server', done => {
    const mockSocket = new WebSocketStub();
    const client = new ArceClient('ws://localhost:12000', mockSocket as unknown as WebSocket);
    const clientSendSpy = sinon.spy(client, 'send');

    mockSocket.triggerOnopen();
    const script = `\
    async (waitUntil, capture, done) => {
      capture(await new Promise(res => setTimeout(() => res('hello'), 1)));
      capture(await waitUntil(() => 'world', 5, 1));
      done();
    }`;
    const message: ArceServerToClientMessage = {script, awaitId: Math.random().toString()};
    const evt = new MessageEvent('message', {data: JSON.stringify(message)})
    mockSocket.triggerOnmessage(evt);

    setTimeout(() => {
      expect(clientSendSpy).callCount(3);
      const firstMessage: ArceClientToServerMessage = clientSendSpy.getCall(0).firstArg;
      expect(firstMessage.awaitId).to.eq(message.awaitId);
      expect(firstMessage.type).to.eq('capture');
      expect(firstMessage.data).to.eq('hello');
      const secondMessage: ArceClientToServerMessage = clientSendSpy.getCall(1).firstArg;
      expect(secondMessage.awaitId).to.eq(message.awaitId);
      expect(secondMessage.type).to.eq('capture');
      expect(secondMessage.data).to.eq('world');
      const thirdMessage: ArceClientToServerMessage = clientSendSpy.getCall(2).firstArg;
      expect(thirdMessage.awaitId).to.eq(message.awaitId);
      expect(thirdMessage.type).to.eq('done');
      expect(thirdMessage.data).to.eq(null);
      done();
    }, 200);
  });

  it('should handle thrown error in command script properly', done => {
    const mockSocket = new WebSocketStub();
    const client = new ArceClient('ws://localhost:12000', mockSocket as unknown as WebSocket);
    const clientSendSpy = sinon.spy(client, 'send');

    mockSocket.triggerOnopen();
    const script = `(waitUntil, capture, done) => {throw Error('BLUB!'); done()}`;
    const message: ArceServerToClientMessage = {script, awaitId: Math.random().toString()};
    const evt = new MessageEvent('message', {data: JSON.stringify(message)})
    mockSocket.triggerOnmessage(evt);

    setTimeout(() => {
      expect(clientSendSpy).callCount(1);
      const firstMessage: ArceClientToServerMessage = clientSendSpy.getCall(0).firstArg;
      expect(firstMessage.awaitId).to.eq(message.awaitId);
      expect(firstMessage.type).to.eq('error');
      expect(firstMessage.data).to.eq('BLUB!');
      done();
    }, 200);
  });

  it('should handle rejected promise in command script properly', done => {
    const mockSocket = new WebSocketStub();
    const client = new ArceClient('ws://localhost:12000', mockSocket as unknown as WebSocket);
    const clientSendSpy = sinon.spy(client, 'send');

    mockSocket.triggerOnopen();
    const script = `async (waitUntil, capture, done) => {await new Promise((res, rej) => rej('REJECTED!')); done()}`;
    const message: ArceServerToClientMessage = {script, awaitId: Math.random().toString()};
    const evt = new MessageEvent('message', {data: JSON.stringify(message)})
    mockSocket.triggerOnmessage(evt);

    setTimeout(() => {
      expect(clientSendSpy).callCount(1);
      const firstMessage: ArceClientToServerMessage = clientSendSpy.getCall(0).firstArg;
      expect(firstMessage.awaitId).to.eq(message.awaitId);
      expect(firstMessage.type).to.eq('error');
      expect(firstMessage.data).to.eq('REJECTED!');
      done();
    }, 200);
  });

  it('should reject waitUntil() promise if condition is not truthy in time', done => {
    const mockSocket = new WebSocketStub();
    const client = new ArceClient('ws://localhost:12000', mockSocket as unknown as WebSocket);
    const clientSendSpy = sinon.spy(client, 'send');

    mockSocket.triggerOnopen();
    const script = `async (waitUntil, capture, done) => {await waitUntil(() => false, 25, 5); done()}`;
    const message: ArceServerToClientMessage = {script, awaitId: Math.random().toString()};
    const evt = new MessageEvent('message', {data: JSON.stringify(message)})
    mockSocket.triggerOnmessage(evt);

    setTimeout(() => {
      expect(clientSendSpy).callCount(1);
      const firstMessage: ArceClientToServerMessage = clientSendSpy.getCall(0).firstArg;
      expect(firstMessage.awaitId).to.eq(message.awaitId);
      expect(firstMessage.type).to.eq('error');
      expect(firstMessage.data).to.eq('timeout');
      done();
    }, 200);
  });


  class WebSocketStub {
    triggerOnopen = () => this.onopen();
    triggerOnclose = () => this.onclose();
    triggerOnmessage = (evt: MessageEvent<string>) => this.onmessage(evt);
    private onopen = () => void 0
    private onclose = () => void 0
    private onmessage = (evt: MessageEvent<string>) => void 0
    private send = (msg: string): void => void 0
  }
});
