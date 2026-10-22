import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure the pool with optimized settings
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  allowExitOnIdle: false
});

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit the process on idle client errors
});

// Add connection health check
pool.on('connect', (client) => {
  console.log('New database client connected');
});

pool.on('acquire', () => {
  console.log('Client acquired from pool');
});

pool.on('remove', () => {
  console.log('Client removed from pool');
});

// Optimized connection monitoring with proper thresholds
let connectionCount = 0;
const MAX_EXPECTED_CONNECTIONS = 20; // Max connections from pool config
const WARNING_THRESHOLD = 15; // Warn when approaching max (75% of max)
let lastWarningTime = 0;

pool.on('connect', () => {
  connectionCount++;
  const now = Date.now();
  if (connectionCount >= WARNING_THRESHOLD && now - lastWarningTime > 60000) {
    console.warn(`📊 Database connection pool nearing capacity: ${connectionCount}/${MAX_EXPECTED_CONNECTIONS} connections active.`);
    lastWarningTime = now;
  }
});

pool.on('remove', () => {
  connectionCount = Math.max(0, connectionCount - 1);
});

// Add connection cleanup on uncaught errors
pool.on('error', (err) => {
  console.error('Database pool error:', err.message);
  // Don't log full stack trace to reduce noise
});

// Optimized connection test with better error handling
const testConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    let client;
    try {
      client = await pool.connect();
      console.log('Database connection successful');
      return true;
    } catch (err) {
      const errorMsg = (err as Error).message;
      console.error(`Database connection attempt ${i + 1} failed:`, errorMsg);

      if (i === retries - 1) {
        console.error('Database connection failed after multiple retries. Server will continue with limited functionality.');
        return false;
      } else {
        // Reduced wait time for faster startup
        const waitTime = Math.min((i + 1) * 1000, 3000);
        console.log(`Retrying in ${waitTime/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.warn('Error releasing database client:', releaseError);
        }
      }
    }
  }
  return false;
};

// Session table management
const ensureSessionTable = async () => {
  let client;
  try {
    client = await pool.connect();

    // Check if session table exists and create only if it doesn't
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'session'
      );
    `);

    if (!tableExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS session (
          sid VARCHAR NOT NULL COLLATE "default",
          sess JSON NOT NULL,
          expire TIMESTAMP(6) NOT NULL
        );
      `);

      // Create index only if it doesn't exist
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS session_expire_idx
        ON session(expire);
      `);

      // Add primary key only if it doesn't exist
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'session_pkey'
          ) THEN
            ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid);
          END IF;
        END $$;
      `);

      console.log('Session table created successfully');
    } else {
      console.log('Session table already exists, skipping creation');
    }

  } catch (err) {
    console.warn('Session table setup warning:', (err as Error).message);
    // Don't throw error - allow server to continue
  } finally {
    if (client) {
      try {
        client.release();
      } catch (releaseError) {
        console.warn('Error releasing database client:', releaseError);
      }
    }
  }
};

// Non-blocking database connection test and session table setup
if (process.env.SKIP_DATABASE_INITIALIZATION !== "1") {
  setTimeout(async () => {
    try {
      const connected = await testConnection();
      if (connected) {
        await ensureSessionTable();
      }
    } catch (err) {
      console.error('Database initialization failed:', err);
    }
  }, 100); // Small delay to not block server startup
}

export const db = drizzle(pool, { schema });

// Export cleanup function for graceful shutdown
export const closePool = async () => {
  console.log('Closing database connection pool...');
  await pool.end();
  console.log('Database connection pool closed.');
};