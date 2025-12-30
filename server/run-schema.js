const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runSchema() {
  const schemaPath = path.join(__dirname, 'src/db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    console.log('Connecting to Supabase...');
    const client = await pool.connect();

    console.log('Running schema...');
    await client.query(schema);

    console.log('Schema created successfully!');
    client.release();
    await pool.end();
  } catch (error) {
    console.error('Error running schema:', error.message);
    process.exit(1);
  }
}

runSchema();
