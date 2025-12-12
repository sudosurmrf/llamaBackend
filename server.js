import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routers from './routers/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { testConnection } from './config/database.js';

const app = express();
const port = process.env.PORT || 3000;

// Parse CORS origins (supports comma-separated list)
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:5173'];

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Llama Treats Bakery API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/health',
  });
});

// Health check endpoint (used by Railway for health checks)
app.get('/api/health', async (req, res) => {
  const dbStatus = await testConnection();

  const health = {
    status: dbStatus.connected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: dbStatus.connected ? 'connected' : 'disconnected',
  };

  // Return 503 if database is down (helps with Railway health checks)
  const statusCode = dbStatus.connected ? 200 : 503;
  res.status(statusCode).json(health);
});

// API routes
app.use('/api', routers);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🦙 Llama Treats Bakery API Server               ║
║                                                   ║
║   Port: ${port}                                       ║
║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(16)}          ║
║   Health: /api/health                             ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

export default app;
