// Preloaded (`node --import`) into a real server process by process-guard.test.ts. Once the server
// is up, it does the three things that used to end the process or corrupt its protocol channel: a
// stray console write, a rejection nobody handles, and an exception nobody catches.
setTimeout(() => {
  console.log('stray console output');
  void Promise.reject(new Error('rejection nobody handled'));
  setTimeout(() => {
    throw new Error('exception nobody caught');
  }, 0);
}, 300);
