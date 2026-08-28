const dns = require('dns');
const tls = require('tls');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Prefer IPv4 when resolving hostnames — cheap, harmless, and avoids issues
// on hosts (Render included) with flaky outbound IPv6 routing.
dns.setDefaultResultOrder('ipv4first');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ciprms';
let client;
let db;
let clientPromise;

// The connection string Atlas hands you in the UI ("Connect → Drivers") has NO
// database in its path — it ends at `.mongodb.net/?retryWrites=...`. In that
// case `client.db()` silently falls back to `test`, so the app connects fine
// but every collection reads back empty. Name the database explicitly.
const DB_NAME = process.env.MONGO_DB_NAME || 'ciprms';

const isTlsConnection = uri.startsWith('mongodb+srv://') || /[?&](tls|ssl)=true\b/i.test(uri);

// Node 20+ bundles OpenSSL 3.0, which enforces "secure renegotiation" and
// rejects the older renegotiation style Atlas's TLS termination still uses —
// surfacing as an opaque "tlsv1 alert internal error" handshake failure with
// no other symptom. SSL_OP_LEGACY_SERVER_CONNECT tells OpenSSL to allow it.
// https://www.mongodb.com/community/forums/t/error-connecting-to-mongodb-shared-cluster-err-ssl-tlsv1-alert-internal-error/299244
const clientOptions = isTlsConnection
  ? {
      tls: true,
      tlsAllowInvalidCertificates: false,
      secureContext: tls.createSecureContext({
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      }),
    }
  : {};

const CONNECT_MAX_ATTEMPTS = 5;
const CONNECT_BASE_DELAY_MS = 1000;

// Atlas's shared/free tier (M0/M2/M5) sheds load under pressure and rejects
// new connections with a 'SystemOverloadedError'-labeled failure rather than
// queuing them — which, at the raw TLS layer, surfaces as an opaque handshake
// error with no other symptom. Giving up on the first attempt and crashing
// only makes this worse: Render restarts the process immediately, which
// reconnects immediately, re-triggering the same rejection. Retrying with
// backoff gives a transient overload a few seconds to clear instead.
// https://www.mongodb.com/docs/atlas/overload-errors/
async function connectWithRetry() {
  for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      const candidate = new MongoClient(uri, clientOptions);
      await candidate.connect();
      client = candidate;
      console.log('✓ Connected to MongoDB successfully');
      return candidate;
    } catch (error) {
      const isLastAttempt = attempt === CONNECT_MAX_ATTEMPTS;
      console.error(`❌ MongoDB connection attempt ${attempt}/${CONNECT_MAX_ATTEMPTS} failed:`, error.message);
      if (isLastAttempt) throw error;
      const delayMs = CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.log(`Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// The session store (connect-mongo) needs a connection at module load time —
// before connectDB() ever runs — and by default opens its own separate
// MongoClient with no retry logic at all, bypassing everything above
// entirely. Sharing one lazily-started, retry-enabled promise between both
// consumers means there's only one connection attempt against Atlas, not
// two racing each other and doubling the load on an already-overloaded
// cluster.
function getClientPromise() {
  if (!clientPromise) clientPromise = connectWithRetry();
  return clientPromise;
}

async function connectDB() {
  if (db) return db;
  const connectedClient = await getClientPromise();
  db = connectedClient.db(DB_NAME);
  console.log(`Using database: ${db.databaseName}`);
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
}

async function closeDB() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
    clientPromise = undefined;
  }
}

module.exports = { connectDB, getDb, closeDB, DB_NAME, getClientPromise };
