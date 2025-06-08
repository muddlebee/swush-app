import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { assetsRouter } from './routes/assets';
import { balancesRouter } from './routes/balances';
import { initializeSDK, cleanupSDK } from '../services';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Initialize SDK
(async () => {
  try {
    await initializeSDK();
    console.log('✅ SDK initialized successfully 🚀');
  } catch (error) {
    console.error('❌ Failed to initialize SDK:', error); 
    process.exit(1);
  }
})();

// Routes
app.use('/api/v1/assets', assetsRouter);
app.use('/api/v1/balances', balancesRouter);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});

// Add global error handlers for PAPI runtime errors
process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Promise Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // For PAPI runtime errors, we'll log but not crash
  if (error.message?.includes('runtime') || error.message?.includes('PAPI') || error.message?.includes('observable')) {
    console.warn('PAPI runtime error caught, continuing execution...');
    return;
  }
  // For other critical errors, we should exit
  process.exit(1);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 