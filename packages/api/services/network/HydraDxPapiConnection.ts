import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { hydration } from '@polkadot-api/descriptors';
import * as SDK from '@galacticcouncil/sdk-next';
import { NETWORKS_SUPPORTED } from '../constants';

export type HydraDxPapiClient = ReturnType<typeof createClient>;
export type HydraDxPapiApi = ReturnType<HydraDxPapiClient['getTypedApi']>;

export interface HydraDxPapiConnection {
  client: HydraDxPapiClient;
  api: HydraDxPapiApi;
  endpoint: string;
  isConnected: boolean;
}

export type ConnectionEventCallback = (
  network: string,
  event: 'connected' | 'disconnected' | 'error',
  error?: Error
) => void;

/**
 * PAPI-based HydraDX connection factory using @galacticcouncil/sdk-next
 * This replaces the legacy Polkadot.js ApiPromise connections
 */
export class HydraDxPapiConnectionFactory {
  private static readonly CONNECTION_TIMEOUT = 15000; // 15 seconds
  private static readonly STABILITY_CHECK_DELAY = 1000; // 1 second

  /**
   * Create a new PAPI-based HydraDX connection
   */
  static async createConnection(
    endpoint: string,
    onConnectionEvent?: ConnectionEventCallback
  ): Promise<HydraDxPapiConnection> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('HydraDX PAPI connection timeout')), this.CONNECTION_TIMEOUT);
    });

    const connectionPromise = async (): Promise<HydraDxPapiConnection> => {
      try {
        console.log(`🔌 Creating HydraDX PAPI connection to: ${endpoint}`);

        // Create WebSocket provider with Node.js implementation
        const wsProvider = getWsProvider(endpoint);
        
        // Create client with Polkadot SDK compatibility
        const client = createClient(withPolkadotSdkCompat(wsProvider));
        
        // Get typed API for HydraDX
        const api = client.getTypedApi(hydration);

        // Test basic connectivity
        await this.validateConnection(api);

        // Set up connection monitoring
        const connection: HydraDxPapiConnection = {
          client,
          api,
          endpoint,
          isConnected: true
        };

        // Set up basic event handling
        if (onConnectionEvent) {
          // PAPI has different event model, set up basic monitoring
          this.setupConnectionMonitoring(connection, onConnectionEvent);
          
          // Notify connection established
          onConnectionEvent(NETWORKS_SUPPORTED.HYDRA_DX, 'connected');
        }

        // Brief stability check
        await new Promise(resolve => setTimeout(resolve, this.STABILITY_CHECK_DELAY));

        console.log(`✅ HydraDX PAPI connection established: ${endpoint}`);
        return connection;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to create HydraDX PAPI connection: ${errorMessage}`);
        
        if (onConnectionEvent) {
          onConnectionEvent(
            NETWORKS_SUPPORTED.HYDRA_DX, 
            'error', 
            error instanceof Error ? error : new Error(errorMessage)
          );
        }
        
        throw new Error(`Failed to create HydraDX PAPI connection: ${errorMessage}`);
      }
    };

    return Promise.race([connectionPromise(), timeoutPromise]);
  }

  /**
   * Validate PAPI connection by performing a test query
   */
  static async validateConnection(api: HydraDxPapiApi): Promise<boolean> {
    try {
      // Use a simpler validation that's less likely to fail
      const validationPromise = Promise.race([
        // Try a very basic constant query
        api.constants.System.Version(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Validation timeout')), 3000)
        )
      ]);

      const chainInfo = await validationPromise;

      // Verify we got valid chain info
      const isValid = !!(chainInfo && typeof chainInfo.spec_name === 'string');
      
      if (!isValid) {
        console.warn('HydraDX PAPI validation: Invalid chain info received');
      }
      
      return isValid;
    } catch (error) {
      // Don't log every validation failure to reduce noise
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('timeout')) {
        console.warn('HydraDX PAPI connection validation failed:', error);
      }
      return false;
    }
  }

  /**
   * Set up basic connection monitoring for PAPI
   */
  private static setupConnectionMonitoring(
    connection: HydraDxPapiConnection,
    onConnectionEvent: ConnectionEventCallback
  ): void {
    try {
      // PAPI handles connection management internally
      // Set up very conservative health checks to avoid reconnection loops
      const healthCheckInterval = setInterval(async () => {
        try {
          // Only check if connection is still marked as connected
          if (!connection.isConnected) {
            clearInterval(healthCheckInterval);
            return;
          }

          const isValid = await this.validateConnection(connection.api);
          if (!isValid && connection.isConnected) {
            console.log('🔄 HydraDX PAPI connection validation failed, marking as disconnected');
            connection.isConnected = false;
            onConnectionEvent(NETWORKS_SUPPORTED.HYDRA_DX, 'disconnected');
            clearInterval(healthCheckInterval);
          }
        } catch (error) {
          // Be less aggressive about triggering disconnections from health checks
          console.warn('PAPI health check error (non-fatal):', error);
          // Don't immediately disconnect on health check errors
        }
      }, 300000); // Check every 5 minutes (very conservative)

      // Store interval reference for cleanup
      (connection as any)._healthCheckInterval = healthCheckInterval;

      // Add error handler for the client to catch unhandled runtime errors
      try {
        // PAPI clients have internal error handling, but we can wrap critical operations
        const originalValidation = this.validateConnection.bind(this);
        this.validateConnection = async (api: HydraDxPapiApi): Promise<boolean> => {
          try {
            return await originalValidation(api);
          } catch (error) {
            console.warn('Validation wrapped error:', error);
            return false;
          }
        };
      } catch (error) {
        console.warn('Error setting up validation wrapper:', error);
      }

    } catch (error) {
      console.warn('Failed to set up HydraDX PAPI connection monitoring:', error);
    }
  }

  /**
   * Disconnect PAPI connection
   */
  static async disconnect(connection: HydraDxPapiConnection): Promise<void> {
    try {
      // Clear health check interval
      if ((connection as any)._healthCheckInterval) {
        clearInterval((connection as any)._healthCheckInterval);
      }

      // Mark as disconnected
      connection.isConnected = false;

      // Destroy the client
      await Promise.race([
        connection.client.destroy(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Disconnect timeout')), 5000)
        )
      ]);

      console.log(`✅ HydraDX PAPI connection disconnected: ${connection.endpoint}`);
    } catch (error) {
      console.warn('Error disconnecting HydraDX PAPI connection:', error);
    }
  }

  /**
   * Create SDK-Next PoolContextProvider using PAPI connection
   */
  static createPoolContext(connection: HydraDxPapiConnection): SDK.pool.PoolContextProvider {
    if (!connection.isConnected) {
      throw new Error('Cannot create pool context with disconnected HydraDX PAPI connection');
    }

    try {
      // Create SDK-Next PoolContextProvider with all pool types
      return new SDK.pool.PoolContextProvider(connection.client)
        .withOmnipool()
        .withStableswap()
        .withXyk();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create HydraDX SDK-Next pool context: ${errorMessage}`);
    }
  }

  /**
   * Create SDK-Next router using pool context
   */
  static createRouter(poolContext: SDK.pool.PoolContextProvider): SDK.sor.Router {
    try {
      return new SDK.sor.Router(poolContext);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create HydraDX SDK-Next router: ${errorMessage}`);
    }
  }

  /**
   * Create SDK-Next trade router using pool context
   */
  static createTradeRouter(poolContext: SDK.pool.PoolContextProvider): SDK.sor.TradeRouter {
    try {
      return new SDK.sor.TradeRouter(poolContext);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create HydraDX SDK-Next trade router: ${errorMessage}`);
    }
  }
} 