import * as SDK from '@galacticcouncil/sdk-next';
import { ConnectionManager } from '../../network/ConnectionManager';
import { HydraDxPapiConnectionFactory, HydraDxPapiConnection } from '../../network/HydraDxPapiConnection';

// Use the actual SDK-Next Trade type
export type SDKTrade = ReturnType<SDK.sor.TradeRouter['getBestSell']> extends Promise<infer T> ? T : never;

/**
 * HydraDX Router Service using @galacticcouncil/sdk-next with PAPI
 * This replaces the legacy TradeRouterService that used Polkadot.js API
 */
export class HydraDxRouterService {
  private static instance: HydraDxRouterService;
  private poolContext: SDK.pool.PoolContextProvider | null = null;
  private router: SDK.sor.Router | null = null;
  private tradeRouter: SDK.sor.TradeRouter | null = null;
  private initialized = false;
  private initializing = false;

  private constructor() {}

  public static getInstance(): HydraDxRouterService {
    if (!this.instance) {
      this.instance = new HydraDxRouterService();
    }
    return this.instance;
  }

  /**
   * Initialize the HydraDX router service with PAPI connection
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('HydraDxRouterService already initialized');
      return;
    }

    if (this.initializing) {
      console.log('HydraDxRouterService initialization in progress, waiting...');
      // Wait for initialization to complete
      while (this.initializing && !this.initialized) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.initializing = true;

    try {
      console.log('🚀 Initializing HydraDxRouterService with SDK-Next...');

      // Get HydraDX PAPI connection from ConnectionManager
      const connectionManager = ConnectionManager.getInstance();
      console.log('Waiting for HydraDX PAPI connection...');
      
      const connection = await connectionManager.getHydraDxPapiConnectionWithRetry(30000);
      
      if (!connection) {
        const status = connectionManager.getConnectionStatus();
        console.error('HydraDX PAPI connection not available. Connection status:', status.hydra_dx);
        throw new Error('HydraDX PAPI connection not available after extended wait');
      }

      console.log('✅ HydraDX PAPI connection available, creating pool context...');

      // Create PoolContextProvider first (required by SDK-Next)
      this.poolContext = HydraDxPapiConnectionFactory.createPoolContext(connection);

      // Create SDK-Next routers using pool context
      this.router = HydraDxPapiConnectionFactory.createRouter(this.poolContext);
      this.tradeRouter = HydraDxPapiConnectionFactory.createTradeRouter(this.poolContext);

      if (!this.poolContext || !this.router || !this.tradeRouter) {
        throw new Error('Failed to create SDK-Next routers');
      }

      this.initialized = true;
      console.log('✅ HydraDxRouterService initialized successfully with SDK-Next');

    } catch (error) {
      console.error('❌ Failed to initialize HydraDxRouterService:', error);
      this.poolContext = null;
      this.router = null;
      this.tradeRouter = null;
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Get the best sell quote using SDK-Next
   * @param assetIn - Asset ID to sell (numeric string)
   * @param assetOut - Asset ID to buy (numeric string)  
   * @param amountIn - Amount to sell in planck units (bigint)
   */
  public async getBestSell(
    assetIn: string,
    assetOut: string,
    amountIn: bigint
  ): Promise<SDKTrade | null> {
    if (!this.initialized || !this.tradeRouter) {
      console.warn('HydraDxRouterService not initialized');
      return null;
    }

    try {
      console.log(`🔄 Getting HydraDX quote: ${assetIn} → ${assetOut}, amount: ${amountIn}`);

      // Convert string asset IDs to numbers (required by SDK-Next)
      const assetInNum = parseInt(assetIn, 10);
      const assetOutNum = parseInt(assetOut, 10);

      // Use SDK-Next TradeRouter for getting quotes
      const quote = await this.tradeRouter.getBestSell(assetInNum, assetOutNum, amountIn);

      if (!quote) {
        console.log('No quote available from HydraDX SDK-Next');
        return null;
      }

      console.log('✅ HydraDX SDK-Next quote received:', quote);
      return quote;

    } catch (error) {
      console.error('❌ Error getting HydraDX SDK-Next quote:', error);
      return null;
    }
  }

  /**
   * Get the best buy quote using SDK-Next
   * @param assetIn - Asset ID to sell (numeric string)
   * @param assetOut - Asset ID to buy (numeric string)
   * @param amountOut - Amount to buy in planck units (bigint)
   */
  public async getBestBuy(
    assetIn: string,
    assetOut: string,
    amountOut: bigint
  ): Promise<SDKTrade | null> {
    if (!this.initialized || !this.tradeRouter) {
      console.warn('HydraDxRouterService not initialized');
      return null;
    }

    try {
      console.log(`🔄 Getting HydraDX buy quote: ${assetIn} → ${assetOut}, amount out: ${amountOut}`);

      // Convert string asset IDs to numbers (required by SDK-Next)
      const assetInNum = parseInt(assetIn, 10);
      const assetOutNum = parseInt(assetOut, 10);

      // Use SDK-Next TradeRouter for getting buy quotes
      const quote = await this.tradeRouter.getBestBuy(assetInNum, assetOutNum, amountOut);

      if (!quote) {
        console.log('No buy quote available from HydraDX SDK-Next');
        return null;
      }

      console.log('✅ HydraDX SDK-Next buy quote received:', quote);
      return quote;

    } catch (error) {
      console.error('❌ Error getting HydraDX SDK-Next buy quote:', error);
      return null;
    }
  }

  /**
   * Get spot price using SDK-Next TradeRouter
   * @param assetIn - Asset ID to sell (numeric string)
   * @param assetOut - Asset ID to buy (numeric string)
   */
  public async getSpotPrice(assetIn: string, assetOut: string): Promise<string | null> {
    if (!this.initialized || !this.tradeRouter) {
      console.warn('HydraDxRouterService not initialized');
      return null;
    }

    try {
      // Convert string asset IDs to numbers
      const assetInNum = parseInt(assetIn, 10);
      const assetOutNum = parseInt(assetOut, 10);

      // Use SDK-Next TradeRouter for spot price
      const spotPrice = await this.tradeRouter.getSpotPrice(assetInNum, assetOutNum);
      return spotPrice ? spotPrice.toString() : null;
    } catch (error) {
      console.error('❌ Error getting HydraDX spot price:', error);
      return null;
    }
  }

  /**
   * Check if the service is properly initialized
   */
  public isInitialized(): boolean {
    return this.initialized && !!this.router && !!this.tradeRouter;
  }

  /**
   * Get the router instance (for advanced usage)
   */
  public getRouter(): SDK.sor.Router | null {
    return this.router;
  }

  /**
   * Get the trade router instance (for advanced usage)
   */
  public getTradeRouter(): SDK.sor.TradeRouter | null {
    return this.tradeRouter;
  }

  /**
   * Reset the service (for reconnection scenarios)
   */
  public reset(): void {
    console.log('🔄 Resetting HydraDxRouterService...');
    
    // Clean up pool context
    if (this.poolContext) {
      try {
        this.poolContext.destroy();
      } catch (error) {
        console.warn('Error destroying pool context:', error);
      }
    }
    
    this.poolContext = null;
    this.router = null;
    this.tradeRouter = null;
    this.initialized = false;
    this.initializing = false;
  }
} 