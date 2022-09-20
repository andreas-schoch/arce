import {HttpResponse} from 'uWebSockets.js';

export const parseBodyString = (res: HttpResponse): Promise<string> => new Promise((resolve, reject) => {
  let buffer: Buffer;
  res.onData((ab, isLast) => {
    const chunk = Buffer.from(ab);
    isLast
      ? resolve((buffer ? Buffer.concat([buffer, chunk]) : chunk).toString())
      : buffer = Buffer.concat(buffer ? [buffer, chunk] : [chunk]);
  });
  res.onAborted(() => reject(null));
});
