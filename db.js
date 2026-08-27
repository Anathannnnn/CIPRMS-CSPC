const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ciprms';
let client;
let db;

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
    db = client.db();
    console.log('✓ Connected to MongoDB successfully');
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

module.exports = { connectDB, getDb, closeDB };
