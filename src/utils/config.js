import ConfigModel from '../models/Config.js';

const cache = new Map();

async function getRawConfig(key) {
  const doc = await ConfigModel.findOne({ key }).lean();
  return doc || null;
}

export async function getConfig(key, opts = {}) {
  const ttl = opts.ttlMs || 30000;
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.ts) < ttl) return cached.value;

  const doc = await getRawConfig(key);
  if (doc) {
    let parsed = doc.value;
    if (doc.type === 'number') parsed = Number(doc.value);
    else if (doc.type === 'json') {
      try { parsed = JSON.parse(doc.value); } catch { parsed = doc.value; }
    }
    cache.set(key, { value: parsed, ts: Date.now() });
    return parsed;
  }

  // fallback to process.env
  if (opts.fallback !== undefined) {
    cache.set(key, { value: opts.fallback, ts: Date.now() });
    return opts.fallback;
  }

  if (process.env[key] !== undefined) {
    const val = process.env[key];
    // try to coerce numbers
    if (!isNaN(Number(val))) {
      const n = Number(val);
      cache.set(key, { value: n, ts: Date.now() });
      return n;
    }
    cache.set(key, { value: val, ts: Date.now() });
    return val;
  }

  return null;
}

export async function setConfig(key, value, opts = {}) {
  const type = opts.type || (typeof value === 'number' ? 'number' : (typeof value === 'object' ? 'json' : 'string'));
  const stored = type === 'json' ? JSON.stringify(value) : String(value);
  const doc = await ConfigModel.findOneAndUpdate({ key }, { value: stored, type, description: opts.description || '', updatedBy: opts.updatedBy, updatedAt: new Date() }, { upsert: true, new: true, setDefaultsOnInsert: true });
  // update cache
  let parsed = doc.value;
  if (doc.type === 'number') parsed = Number(doc.value);
  else if (doc.type === 'json') {
    try { parsed = JSON.parse(doc.value); } catch { parsed = doc.value; }
  }
  cache.set(key, { value: parsed, ts: Date.now() });
  return parsed;
}

// Migrate commonly expected env keys into DB if not present
export async function migrateEnvToDb(fastify) {
  try {
    const migrateKeys = ['COMPANY_FEE_PCT'];
    for (const k of migrateKeys) {
      const exists = await ConfigModel.findOne({ key: k }).lean();
      if (!exists && process.env[k] !== undefined) {
        const raw = process.env[k];
        const val = !isNaN(Number(raw)) ? Number(raw) : raw;
        await setConfig(k, val, { type: typeof val === 'number' ? 'number' : 'string', description: `Migrated from .env on startup` });
        fastify?.log?.info?.({ key: k, value: val }, 'migrated env config to DB');
      }
    }
  } catch (err) {
    fastify?.log?.error?.('migrateEnvToDb failed', err?.message || err);
  }
}

export default { getConfig, setConfig, migrateEnvToDb };
