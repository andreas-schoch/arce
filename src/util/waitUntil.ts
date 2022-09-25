export const waitUntil = <T>(fn: () => T, timeout = 5000, interval = 100): Promise<T> => new Promise((res, rej) => {
  const start = Date.now();
  const intervalHandle = setInterval(() => {
    const result = fn();
    if (result) {
      clearInterval(intervalHandle);
      res(result);
    } else if (Date.now() - start > timeout) {
      clearInterval(intervalHandle);
      rej('timeout');
    }
  }, interval);
});
