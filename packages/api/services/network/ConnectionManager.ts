import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { ApiPromise } from '@polkadot/api';
import { EndpointProvider } from './EndpointProvider';
import { ConnectionFactory, AssetHubConnection, ConnectionEventCallback } from './ConnectionFactory';
import { HydraDxPapiConnectionFactory, HydraDxPapiConnection } from './HydraDxPapiConnection';
import { CONNECTION_HEALTH_CHECK_INTERVAL, NETWORKS_SUPPORTED } from '../constants';

interface NetworkConnection {
    connection: AssetHubConnection | ApiPromise | HydraDxPapiConnection | null;
    isReady: boolean;
    isConnecting: boolean;
    lastConnected: Date | null;
    consecutiveFailures: number;
    lastError: Error | null;
    currentEndpoint: string | null;
}

interface ConnectionHealth {
    isHealthy: boolean;
    lastCheck: Date;
    responseTime: number;
}

export class ConnectionManager {
    private static instance: ConnectionManager;
    private connections: Map<string, NetworkConnection> = new Map();
    private connectionHealth: Map<string, ConnectionHealth> = new Map();
    private endpointProvider: EndpointProvider;
    private initialized: boolean = false;
    private isShuttingDown: boolean = false;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private reconnectionTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private connectionLocks: Map<string, boolean> = new Map(); // Prevent race conditions

    private constructor() {
        this.endpointProvider = EndpointProvider.getInstance();
        this.initializeConnections();
        this.setupHealthChecking();
    }

    private initializeConnections(): void {
        Object.values(NETWORKS_SUPPORTED).forEach(network => {
            this.connections.set(network, {
                connection: null,
                isReady: false,
                isConnecting: false,
                lastConnected: null,
                consecutiveFailures: 0,
                lastError: null,
                currentEndpoint: null
            });
            
            this.connectionHealth.set(network, {
                isHealthy: false,
                lastCheck: new Date(0),
                responseTime: 0
            });

            this.connectionLocks.set(network, false);
        });
    }

    private setupHealthChecking(): void {
        // Reduce health check frequency to prevent reconnection loops
        this.healthCheckInterval = setInterval(async () => {
            if (!this.isShuttingDown && this.initialized) {
                await this.performHealthChecks();
            }
        }, 120000); // Check every 2 minutes to be less aggressive
    }

    private async performHealthChecks(): Promise<void> {
        const promises = Array.from(this.connections.keys()).map(async (network) => {
            const connection = this.connections.get(network);
            if (!connection?.isReady || !connection.connection) return;

            try {
                const startTime = Date.now();
                let isValid = false;
                
                if (network === NETWORKS_SUPPORTED.HYDRA_DX) {
                    // Use PAPI validation for HydraDX
                    const papiConnection = connection.connection as HydraDxPapiConnection;
                    if (papiConnection && papiConnection.api) {
                        isValid = await HydraDxPapiConnectionFactory.validateConnection(papiConnection.api);
                    }
                } else {
                    // Use existing validation for other networks
                    isValid = await ConnectionFactory.validateConnection(connection.connection, network);
                }
                
                if (!isValid) {
                    throw new Error('Connection validation failed');
                }
                
                const responseTime = Date.now() - startTime;
                
                this.connectionHealth.set(network, {
                    isHealthy: true,
                    lastCheck: new Date(),
                    responseTime
                });
            } catch (error) {
                console.warn(`Health check failed for ${network}:`, error);
                this.connectionHealth.set(network, {
                    isHealthy: false,
                    lastCheck: new Date(),
                    responseTime: 0
                });
                
                // If health check fails, mark connection as not ready and attempt reconnection
                connection.isReady = false;
                this.scheduleReconnection(network);
            }
        });

        await Promise.allSettled(promises);
    }

    // Connection event handler for immediate reconnection
    private handleConnectionEvent: ConnectionEventCallback = (network, event, error) => {
        const connection = this.connections.get(network);
        if (!connection) return;

        switch (event) {
            case 'connected':
                console.log(`✅ ${network} connection established`);
                connection.consecutiveFailures = 0;
                connection.lastError = null;
                connection.isReady = true;
                connection.lastConnected = new Date();
                this.connectionHealth.set(network, {
                    isHealthy: true,
                    lastCheck: new Date(),
                    responseTime: 0
                });
                break;

            case 'disconnected':
                console.warn(`⚠️ ${network} connection lost - scheduling immediate reconnection`);
                connection.isReady = false;
                this.connectionHealth.set(network, {
                    isHealthy: false,
                    lastCheck: new Date(),
                    responseTime: 0
                });
                // Mark current endpoint as failed
                if (connection.currentEndpoint) {
                    this.endpointProvider.markEndpointFailed(network, connection.currentEndpoint);
                }
                // Immediate reconnection attempt for disconnections
                this.scheduleReconnection(network, 1000); // 1 second delay
                break;

            case 'error':
                console.error(`❌ ${network} connection error:`, error);
                connection.lastError = error || new Error('Unknown connection error');
                connection.isReady = false;
                this.connectionHealth.set(network, {
                    isHealthy: false,
                    lastCheck: new Date(),
                    responseTime: 0
                });
                // Mark current endpoint as failed
                if (connection.currentEndpoint) {
                    this.endpointProvider.markEndpointFailed(network, connection.currentEndpoint);
                }
                // Schedule reconnection with backoff for errors
                this.scheduleReconnection(network);
                break;
        }
    };

    private scheduleReconnection(network: string, customDelay?: number): void {
        // Prevent multiple reconnection attempts
        if (this.connectionLocks.get(network)) {
            console.log(`🔒 Reconnection already in progress for ${network}, skipping`);
            return;
        }

        // Clear any existing reconnection timeout
        const existingTimeout = this.reconnectionTimeouts.get(network);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.reconnectionTimeouts.delete(network);
        }

        const connectionState = this.connections.get(network);
        if (!connectionState || connectionState.isConnecting || this.isShuttingDown) {
            console.log(`Skipping reconnection for ${network}: isConnecting=${connectionState?.isConnecting}, isShuttingDown=${this.isShuttingDown}`);
            return;
        }

        // Use custom delay or calculate exponential backoff
        const delay = customDelay || Math.min(
            1000 * Math.pow(2, connectionState.consecutiveFailures),
            30000 // Max 30 seconds
        );

        console.log(`🔄 Scheduling reconnection for ${network} in ${delay}ms (attempt ${connectionState.consecutiveFailures + 1})`);
        
        const timeout = setTimeout(async () => {
            this.reconnectionTimeouts.delete(network);
            if (this.isShuttingDown) return;
            
            try {
                await this.connectToNetworkWithLock(network);
            } catch (error) {
                console.error(`Reconnection failed for ${network}:`, error);
                // Increment failure count and schedule next attempt
                connectionState.consecutiveFailures++;
                this.scheduleReconnection(network);
            }
        }, delay);

        this.reconnectionTimeouts.set(network, timeout);
    }

    private async connectToNetworkWithLock(network: string): Promise<void> {
        // Acquire lock to prevent race conditions
        if (this.connectionLocks.get(network)) {
            console.log(`🔒 Connection attempt already in progress for ${network}`);
            return;
        }

        this.connectionLocks.set(network, true);
        
        try {
            await this.connectToNetwork(network);
        } finally {
            this.connectionLocks.set(network, false);
        }
    }

    private async connectToNetwork(network: string): Promise<void> {
        const connectionState = this.connections.get(network);
        if (!connectionState) return;

        // Double-check if already connecting (race condition protection)
        if (connectionState.isConnecting) {
            console.log(`⚠️ ${network} already connecting, skipping duplicate attempt`);
            return;
        }

        connectionState.isConnecting = true;
        connectionState.isReady = false;

        let selectedEndpoint: string | null = null;

        try {
            // Clean up existing connection first
            await this.cleanupConnection(network);

            selectedEndpoint = this.endpointProvider.getEndpoint(network);
            connectionState.currentEndpoint = selectedEndpoint;
            console.log(`🔌 Connecting to ${network} via ${selectedEndpoint}`);

            let connection: AssetHubConnection | ApiPromise | HydraDxPapiConnection;
            
            switch (network) {
                case NETWORKS_SUPPORTED.ASSET_HUB:
                    connection = await ConnectionFactory.createAssetHubConnection(selectedEndpoint, this.handleConnectionEvent);
                    break;
                case NETWORKS_SUPPORTED.HYDRA_DX:
                    // Use PAPI connection for HydraDX (SDK-Next compatible)
                    connection = await HydraDxPapiConnectionFactory.createConnection(selectedEndpoint, this.handleConnectionEvent);
                    break;
                default:
                    throw new Error(`Unsupported network: ${network}`);
            }

            // Validate the connection before marking as ready
            let isValid = false;
            if (network === NETWORKS_SUPPORTED.HYDRA_DX) {
                // Use PAPI validation for HydraDX
                const papiConnection = connection as HydraDxPapiConnection;
                isValid = await HydraDxPapiConnectionFactory.validateConnection(papiConnection.api);
            } else {
                // Use existing validation for other networks
                isValid = await ConnectionFactory.validateConnection(connection, network);
            }
            
            if (!isValid) {
                throw new Error('Connection validation failed');
            }

            connectionState.connection = connection;
            connectionState.isReady = true;
            connectionState.lastConnected = new Date();
            connectionState.consecutiveFailures = 0;
            connectionState.lastError = null;

            this.connectionHealth.set(network, {
                isHealthy: true,
                lastCheck: new Date(),
                responseTime: 0
            });

            console.log(`✅ Successfully connected to ${network}`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown connection error');
            connectionState.consecutiveFailures++;
            connectionState.lastError = err;
            
            // Mark endpoint as failed for this session
            if (selectedEndpoint) {
                this.endpointProvider.markEndpointFailed(network, selectedEndpoint);
                console.log(`🚫 Marked endpoint as failed: ${selectedEndpoint}`);
            }
            
            console.error(`❌ Failed to connect to ${network}:`, err.message);
            throw err;
        } finally {
            connectionState.isConnecting = false;
        }
    }

    private async cleanupConnection(network: string): Promise<void> {
        const connectionState = this.connections.get(network);
        if (!connectionState?.connection) return;

        try {
            // Mark as not ready immediately to prevent usage during cleanup
            connectionState.isReady = false;
            
            if (network === NETWORKS_SUPPORTED.ASSET_HUB) {
                const connection = connectionState.connection as AssetHubConnection;
                await ConnectionFactory.disconnectAssetHub(connection);
            } else if (network === NETWORKS_SUPPORTED.HYDRA_DX) {
                // Handle both legacy and PAPI connections
                const connection = connectionState.connection;
                if ((connection as HydraDxPapiConnection).client) {
                    // PAPI connection
                    const papiConnection = connection as HydraDxPapiConnection;
                    await HydraDxPapiConnectionFactory.disconnect(papiConnection);
                } else {
                    // Legacy Polkadot.js connection
                    const api = connection as ApiPromise;
                    await ConnectionFactory.disconnectHydradx(api);
                }
            }
        } catch (error) {
            console.warn(`Error cleaning up ${network} connection:`, error);
        } finally {
            // Ensure state is fully reset
            connectionState.connection = null;
            connectionState.isReady = false;
            connectionState.currentEndpoint = null;
            connectionState.isConnecting = false;
            
            // Update health status
            this.connectionHealth.set(network, {
                isHealthy: false,
                lastCheck: new Date(),
                responseTime: 0
            });
        }
    }

    public static getInstance(): ConnectionManager {
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager();
        }
        return ConnectionManager.instance;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('Initializing ConnectionManager...');
        
        try {
            // Connect to all networks in parallel with locks
            const connectionPromises = Object.values(NETWORKS_SUPPORTED).map(network => 
                this.connectToNetworkWithLock(network)
            );

            await Promise.allSettled(connectionPromises);
            
            this.initialized = true;
            console.log('✅ ConnectionManager initialization completed');
        } catch (error) {
            console.error('Failed to initialize all connections:', error);
            // Don't throw - some connections might have succeeded
            this.initialized = true; // Mark as initialized even with partial failures
        }
    }

    public async waitForConnection(network: string, timeoutMs: number = 10000): Promise<boolean> {
        const connectionState = this.connections.get(network);
        if (!connectionState) return false;

        // If already ready, return immediately
        if (connectionState.isReady && connectionState.connection) {
            return true;
        }

        // If not connecting, start connection
        if (!connectionState.isConnecting && !this.connectionLocks.get(network)) {
            this.connectToNetworkWithLock(network).catch(console.error);
        }

        // Wait for connection with timeout
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (connectionState.isReady && connectionState.connection) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return false;
    }

    public getAssetHubApi(): TypedApi<typeof polkadot_asset_hub> | null {
        const connection = this.connections.get(NETWORKS_SUPPORTED.ASSET_HUB);
        if (!connection?.isReady || !connection.connection) {
            return null;
        }
        
        const assetHubConnection = connection.connection as AssetHubConnection;
        return assetHubConnection.api;
    }

    public getHydradxApi(): ApiPromise | null {
        const connection = this.connections.get(NETWORKS_SUPPORTED.HYDRA_DX);
        if (!connection?.isReady || !connection.connection) {
            return null;
        }
        
        const api = connection.connection as ApiPromise;
        
        // Quick stale connection check
        try {
            if (!api.isConnected) {
                console.warn('HydraDX API connection is stale, marking as not ready');
                connection.isReady = false;
                this.scheduleReconnection(NETWORKS_SUPPORTED.HYDRA_DX, 100); // Immediate reconnection
                return null;
            }
        } catch (error) {
            console.warn('Error checking HydraDX API connection state:', error);
            connection.isReady = false;
            this.scheduleReconnection(NETWORKS_SUPPORTED.HYDRA_DX, 100);
            return null;
        }
        
        return api;
    }

    public async getAssetHubApiWithRetry(timeoutMs: number = 5000): Promise<TypedApi<typeof polkadot_asset_hub> | null> {
        // Try to get immediate connection
        const api = this.getAssetHubApi();
        if (api) return api;

        // Wait for connection to become available
        const isReady = await this.waitForConnection(NETWORKS_SUPPORTED.ASSET_HUB, timeoutMs);
        return isReady ? this.getAssetHubApi() : null;
    }

    public async getHydradxApiWithRetry(timeoutMs: number = 5000): Promise<ApiPromise | null> {
        try {
            // Try to get immediate connection
            let api = this.getHydradxApi();
            if (api) {
                // Quick validation with timeout protection
                try {
                    const validationPromise = ConnectionFactory.validateConnection(api, NETWORKS_SUPPORTED.HYDRA_DX);
                    const timeoutPromise = new Promise<boolean>(resolve => 
                        setTimeout(() => resolve(false), 1000) // 1s timeout for validation
                    );
                    
                    const isValid = await Promise.race([validationPromise, timeoutPromise]);
                    if (isValid) {
                        return api;
                    } else {
                        console.warn('HydraDX API failed validation, reconnecting...');
                        const connection = this.connections.get(NETWORKS_SUPPORTED.HYDRA_DX);
                        if (connection) {
                            connection.isReady = false;
                            this.scheduleReconnection(NETWORKS_SUPPORTED.HYDRA_DX, 100);
                        }
                    }
                } catch (error) {
                    console.warn('HydraDX API validation error:', error);
                    // Don't return the potentially bad connection, try to get a fresh one
                    const connection = this.connections.get(NETWORKS_SUPPORTED.HYDRA_DX);
                    if (connection) {
                        connection.isReady = false;
                        this.scheduleReconnection(NETWORKS_SUPPORTED.HYDRA_DX, 100);
                    }
                }
            }

            // Wait for connection to become available
            const isReady = await this.waitForConnection(NETWORKS_SUPPORTED.HYDRA_DX, timeoutMs);
            return isReady ? this.getHydradxApi() : null;
        } catch (error) {
            console.error('Error in getHydradxApiWithRetry:', error);
            return null;
        }
    }

    /**
     * Get HydraDX PAPI connection (new SDK-Next compatible)
     */
    public getHydraDxPapiConnection(): HydraDxPapiConnection | null {
        const connection = this.connections.get(NETWORKS_SUPPORTED.HYDRA_DX);
        if (!connection?.isReady || !connection.connection) {
            return null;
        }

        // Check if this is a PAPI connection
        const papiConnection = connection.connection as HydraDxPapiConnection;
        if (papiConnection && typeof papiConnection.api !== 'undefined' && papiConnection.isConnected) {
            return papiConnection;
        }

        return null;
    }

    /**
     * Get HydraDX PAPI connection with retry (new SDK-Next compatible)
     */
    public async getHydraDxPapiConnectionWithRetry(timeoutMs: number = 5000): Promise<HydraDxPapiConnection | null> {
        try {
            // Try to get immediate PAPI connection
            let connection = this.getHydraDxPapiConnection();
            if (connection) {
                // Quick validation
                try {
                    const isValid = await HydraDxPapiConnectionFactory.validateConnection(connection.api);
                    if (isValid) {
                        return connection;
                    } else {
                        console.warn('HydraDX PAPI connection failed validation, reconnecting...');
                        const connectionState = this.connections.get(NETWORKS_SUPPORTED.HYDRA_DX);
                        if (connectionState) {
                            connectionState.isReady = false;
                            this.scheduleReconnection(NETWORKS_SUPPORTED.HYDRA_DX, 100);
                        }
                    }
                } catch (error) {
                    console.warn('HydraDX PAPI connection validation error:', error);
                    const connectionState = this.connections.get(NETWORKS_SUPPORTED.HYDRA_DX);
                    if (connectionState) {
                        connectionState.isReady = false;
                        this.scheduleReconnection(NETWORKS_SUPPORTED.HYDRA_DX, 100);
                    }
                }
            }

            // Wait for connection to become available
            const isReady = await this.waitForConnection(NETWORKS_SUPPORTED.HYDRA_DX, timeoutMs);
            return isReady ? this.getHydraDxPapiConnection() : null;
        } catch (error) {
            console.error('Error in getHydraDxPapiConnectionWithRetry:', error);
            return null;
        }
    }

    public getConnectionStatus(): Record<string, { 
        isReady: boolean; 
        isHealthy: boolean; 
        lastError: string | null; 
        endpointStatus?: any; 
        consecutiveFailures?: number;
        currentEndpoint?: string | null;
        isConnecting?: boolean;
    }> {
        const status: Record<string, { 
            isReady: boolean; 
            isHealthy: boolean; 
            lastError: string | null; 
            endpointStatus?: any; 
            consecutiveFailures?: number;
            currentEndpoint?: string | null;
            isConnecting?: boolean;
        }> = {};
        
        for (const [network, connection] of this.connections) {
            const health = this.connectionHealth.get(network);
            const endpointStatus = this.endpointProvider.getEndpointStatus(network);
            
            status[network] = {
                isReady: connection.isReady,
                isHealthy: health?.isHealthy || false,
                lastError: connection.lastError?.message || null,
                endpointStatus,
                consecutiveFailures: connection.consecutiveFailures,
                currentEndpoint: connection.currentEndpoint,
                isConnecting: connection.isConnecting
            };
        }
        
        return status;
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    public async disconnect(): Promise<void> {
        this.isShuttingDown = true;
        
        // Clear health check interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        // Clear all reconnection timeouts
        for (const timeout of this.reconnectionTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.reconnectionTimeouts.clear();

        // Clear all locks
        this.connectionLocks.forEach((_, network) => {
            this.connectionLocks.set(network, false);
        });

        try {
            // Cleanup all connections
            const cleanupPromises = Array.from(this.connections.keys()).map(network => 
                this.cleanupConnection(network)
            );
            await Promise.all(cleanupPromises);
            
            this.initialized = false;
            console.log('ConnectionManager disconnected successfully');
        } catch (error) {
            console.error('Error during ConnectionManager disconnect:', error);
            throw error;
        } finally {
            this.isShuttingDown = false;
        }
    }
} 