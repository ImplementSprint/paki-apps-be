/**
 * CORS configuration
 * In development: accepts any localhost origin (Vite may use 5173-5179+ depending on process count)
 * In production:  accepts only the configured CLIENT_URL
 */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, Postman, curl)
    if (!origin) return callback(null, true);

    // Allow any localhost port in development
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Allow the production client URL from env (if set)
    const prodUrl = process.env.CLIENT_URL;
    if (prodUrl && origin === prodUrl) {
      return callback(null, true);
    }

    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = corsOptions;