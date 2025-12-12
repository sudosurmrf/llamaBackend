import pg from 'pg';
const { Pool } = pg;

// Support both DATABASE_URL (Railway/Heroku) and individual env vars
const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'llama_bakery',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    };

const pool = new Pool({
  ...connectionConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test the connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit in production, let the health check handle it
  if (process.env.NODE_ENV !== 'production') {
    process.exit(-1);
  }
});

// Helper function to run queries
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Get a client from the pool for transactions
export const getClient = async () => {
  const client = await pool.connect();
  return client;
};

// Test database connection
export const testConnection = async () => {
  try {
    const result = await query('SELECT NOW()');
    return { connected: true, timestamp: result.rows[0].now };
  } catch (error) {
    return { connected: false, error: error.message };
  }
};

export default pool;
