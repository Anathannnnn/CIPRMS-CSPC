const dns = require('dns');
const { MongoClient } = require('mongodb');

// Render's containers have flaky outbound IPv6 — Node's default DNS order
// prefers IPv6 addresses, and that path silently breaks mid-connection on
// Render, which surfaces as an opaque TLS failure ("tlsv1 alert internal
// error") rather than a clear connection error. Preferring IPv4 avoids it.
dns.setDefaultResultOrder('ipv4first');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ciprms';
let client;
let db;

// The connection string Atlas hands you in the UI ("Connect → Drivers") has NO
// database in its path — it ends at `.mongodb.net/?retryWrites=...`. In that
// case `client.db()` silently falls back to `test`, so the app connects fine
// but every collection reads back empty. Name the database explicitly.
const DB_NAME = process.env.MONGO_DB_NAME || 'ciprms';

// MongoClient options — explicit TLS settings prevent SSL handshake failures
// on cloud platforms (e.g. Render) caused by Node.js OpenSSL version mismatches.
const clientOptions = uri.startsWith('mongodb+srv')
  ? { tls: true, tlsAllowInvalidCertificates: false }
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

module.exports = { connectDB, getDb, closeDB, DB_NAME };
