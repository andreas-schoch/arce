import {ArceCommand} from "../interfaces";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esprima = require('esprima'); // TODO find better way. esprima doesn't seem to work with es6 imports

export const hasError = (script: ArceCommand['script']): string | false => {
  try {
    esprima.parseScript(script);
  } catch (e) {
    // TODO find better way to allow return statement
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (e.description === 'Illegal return statement') return false;
    console.log('parseScript error', e);
    return String(e);
  }
  return false;
}
