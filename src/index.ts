#!/usr/bin/env node
import {ArceServer} from "./arce-server";
import yargs from 'yargs/yargs';


const argv = yargs(process.argv.slice(2)).options({
  ssl_cert: {type: 'string', default: '', describe: 'ssl certificate'},
  ssl_key: {type: 'string', default: '', describe: 'ssl key'},
}).parseSync();

new ArceServer(argv.ssl_cert, argv.ssl_key).start();
