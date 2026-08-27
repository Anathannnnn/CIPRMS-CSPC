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

async function connectDB() {
  if (db) return db;
  try {
    client = new MongoClient(uri, clientOptions);
    await client.connect();
    db = client.db(DB_NAME);
    console.log(`✓ Connected to MongoDB successfully (database: ${db.databaseName})`);
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
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
  }
}

module.exports = { connectDB, getDb, closeDB, DB_NAME, clientOptions };
