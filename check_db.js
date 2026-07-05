const mongoose = require('mongoose');

const MONGODB_URI = "mongodb+srv://luannt:luannt@cluster0.99mpi.mongodb.net/";

const run = async () => {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Get administrative info
  const adminDb = mongoose.connection.useDb('admin').db;
  const dbs = await adminDb.admin().listDatabases();
  console.log("Databases list:");
  dbs.databases.forEach(db => {
    console.log(`- Name: ${db.name}, Size: ${db.sizeOnDisk} bytes`);
  });

  // Check specific databases
  const dbNames = ['test', 'loto88', 'vuaxoso'];
  for (const name of dbNames) {
    const db = mongoose.connection.useDb(name);
    console.log(`\nInspecting Database: ${name}`);
    const collections = await db.db.listCollections().toArray();
    if (collections.length === 0) {
      console.log("  No collections found.");
    } else {
      for (const col of collections) {
        const count = await db.collection(col.name).countDocuments();
        console.log(`  - Collection: ${col.name}, Count: ${count}`);
      }
    }
  }

  mongoose.disconnect();
};

run().catch(err => {
  console.error("DB check failed:", err);
  mongoose.disconnect();
});
