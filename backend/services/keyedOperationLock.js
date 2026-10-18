function createKeyedOperationLock() {
  const locks = new Map();

  return async function run(key, operation) {
    const normalizedKey = String(key);
    const previous = locks.get(normalizedKey) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    locks.set(normalizedKey, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(normalizedKey) === current) {
        locks.delete(normalizedKey);
      }
    }
  };
}

module.exports = createKeyedOperationLock;
