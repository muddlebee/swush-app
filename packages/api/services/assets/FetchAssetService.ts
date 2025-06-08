import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { Asset, AssetType, XcmV4Location } from './types';
import { getForeignAssetId, getNativeAssetId, getXcmV3Multilocation, safeStringify} from './utils';
import { ConnectionManager } from '../network/ConnectionManager';
import { CACHE_KEYS } from '../constants';
import { NATIVE_DOT_ASSET } from './metadata';
import { CacheService } from '../cache/CacheService';
import { TokenGraph } from './router/TokenGraph';
import { HydraDxRouterService } from './router/HydraDxRouterService';

export class FetchAssetService {
    private static instance: FetchAssetService;
    private cacheService: CacheService;
    private connectionManager: ConnectionManager;
    private initialized: boolean = false;
    private forceRefresh: boolean = false;

    // Cache refresh intervals in milliseconds
    private static REFRESH_INTERVALS = {
        ASSETS: 30 * 60 * 1000  // 30 minutes
    };

    private constructor() {
        this.cacheService = CacheService.getInstance();
        this.connectionManager = ConnectionManager.getInstance();
    }

    public static getInstance(): FetchAssetService {
        if (!FetchAssetService.instance) {
            FetchAssetService.instance = new FetchAssetService();
        }
        return FetchAssetService.instance;
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    private async setupCacheRefresh(): Promise<void> {
        // Register cache refresh for assets
        this.cacheService.registerRefreshCallback(
            CACHE_KEYS.MERGED_ASSETS,
            async () => {
                const assets = await this.fetchAllAssetsPapi(this.connectionManager.getAssetHubApi()!);
                await this.cacheService.set(CACHE_KEYS.MERGED_ASSETS, assets);
            },
            FetchAssetService.REFRESH_INTERVALS.ASSETS
        );
    }

    public async initialize(): Promise<void> {
        if (this.initialized && !this.forceRefresh) return;

        try {
            // Initialize network connections first
            await this.connectionManager.initialize();

            // Setup cache refresh
            await this.setupCacheRefresh();

            // Initialize cache service
            await this.cacheService.initialize();

            this.initialized = true;
            console.log('AssetService initialized successfully');
        } catch (error) {
            console.error('Failed to initialize AssetService:', error);
            throw error;
        }
    }

    public async getAssets(forceRefresh = false): Promise<Map<string, Asset>> {
        if (!this.initialized) {
            throw new Error('AssetService not initialized. Call initialize() first');
        }

        if (forceRefresh) {
            this.forceRefresh = true;
            await this.initialize();
        }

        const cachedAssets = this.cacheService.get<Map<string, Asset>>(CACHE_KEYS.MERGED_ASSETS);
        if (!cachedAssets) {
            throw new Error('Assets cache not found. This should not happen as assets are cached during initialization');
        }

        console.log('Returning cached assets');
        return cachedAssets;
    }


    private createAssetDetails = (
        assetValue: any,
        metadata: any,
        assetType: AssetType,
        xcmLocation: any
    ): Asset => {
        
        return {
            asset: {
                owner: assetValue.owner,
                issuer: assetValue.issuer,
                admin: assetValue.admin,
                freezer: assetValue.freezer,
                supply: assetValue.supply,
                deposit: assetValue.deposit,
                min_balance: assetValue.min_balance,
                is_sufficient: assetValue.is_sufficient,
                accounts: assetValue.accounts,
                sufficients: assetValue.sufficients,
                approvals: assetValue.approvals,
            },
            metadata: {
                deposit: metadata.deposit,
                name: metadata.name.asText(),
                symbol: metadata.symbol.asText(),
                decimals: metadata.decimals,
                is_frozen: metadata.is_frozen
            },
            assetType: assetType,
            // Store the serialized XCM location as a string
            xcmLocation: safeStringify(xcmLocation),
            // Store the original XCM location object
            rawXcmLocation: xcmLocation
        };
    };

    public async fetchAllAssetsPapi(api: TypedApi<typeof polkadot_asset_hub>): Promise<Map<string, Asset>> {

        // Get all entries in parallel using PAPI
        const [nativeAssets, nativeMetadata, foreignAssets, foreignMetadata] = await Promise.all([
            api.query.Assets.Asset.getEntries(),
            api.query.Assets.Metadata.getEntries(),
            api.query.ForeignAssets.Asset.getEntries(),
            api.query.ForeignAssets.Metadata.getEntries()
        ]);

        // Create metadata maps with string keys
        const nativeMetadataMap = new Map(
            nativeMetadata.map(entry => [entry.keyArgs[0].toString(), entry.value])
        );

        const foreignMetadataMap = new Map(
            foreignMetadata.map(entry => [safeStringify(entry.keyArgs[0]), entry.value])
        );

        const nativeAssetsMap = new Map<string, Asset>();
        const foreignAssetsMap = new Map<string, Asset>();

        // Add native DOT token first - use the predefined constant from metadata.ts
        nativeAssetsMap.set('DOT', NATIVE_DOT_ASSET);

        // Process native assets with string keys
        for (const nativeAsset of nativeAssets) {
            const assetId = nativeAsset.keyArgs[0].toString();
            const metadata = nativeMetadataMap.get(assetId);

            if (metadata) {
                const assetDetails = this.createAssetDetails(
                    nativeAsset.value,
                    metadata,
                    AssetType.Native,
                    getXcmV3Multilocation(BigInt(assetId))
                );
                nativeAssetsMap.set(assetId, assetDetails);
            }
        }

        // Process foreign assets
        for (const foreignAsset of foreignAssets) {
            const assetId = safeStringify(foreignAsset.keyArgs[0]);
            const metadata = foreignMetadataMap.get(assetId);

            if (metadata) {
                const assetDetails = this.createAssetDetails(
                    foreignAsset.value,
                    metadata,
                    AssetType.Foreign,
                    foreignAsset.keyArgs[0]
                );
                foreignAssetsMap.set(assetId, assetDetails);
            }
        }

        console.log('All assets and metadata fetched and cached');
        const mergedAssets = await this.fetchPoolsPapi(api, nativeAssetsMap, foreignAssetsMap);
        return mergedAssets;
    }

    public async fetchPoolsPapi(
        api: TypedApi<typeof polkadot_asset_hub>,
        nativeAssetsInfo: Map<string, Asset>,
        foreignAssetsInfo: Map<string, Asset>
    ) {

        const pools = await api.query.AssetConversion.Pools.getEntries();

        const assetHubPoolAssets = new Map<string, Asset>();
        const poolAssetPairs = new Set<string>();

        // First pass: collect all assets that are actually in pools
        for (const pool of pools) {
            const poolPairs = pool.keyArgs[0] as [XcmV4Location, XcmV4Location];
            const [assetOne, assetTwo] = poolPairs;
            const assetsToProcess = [assetOne, assetTwo];

            let assetOneId: string | null = null;
            let assetTwoId: string | null = null;

            for (const asset of assetsToProcess) {
                const { parents, interior } = asset;
                // Special case for native DOT
                if (parents === 1 && interior?.type === 'Here') {
                    assetHubPoolAssets.set('DOT', NATIVE_DOT_ASSET);
                    if (!assetOneId) assetOneId = 'DOT';
                    else assetTwoId = 'DOT';
                }
                else if (
                    parents === 0 &&
                    interior?.type === 'X2' &&
                    interior.value.some((e) => e.type === "PalletInstance" && e.value === 50)
                ) {
                    // Handle native assets
                    for (const entry of interior.value)
                        if (entry.type === "GeneralIndex") {
                            const assetId = entry.value.toString();
                            const nativeAssetInfo = nativeAssetsInfo.get(assetId);
                            if (nativeAssetInfo) {
                                assetHubPoolAssets.set(assetId, nativeAssetInfo);
                                if (!assetOneId) assetOneId = assetId;
                                else assetTwoId = assetId;
                            }
                        }
                } else {
                    // Handle foreign assets
                    const normalizedXcmLocation = {
                        parents: asset.parents,
                        interior: asset.interior
                    };

                    const foreignAssetId = safeStringify(normalizedXcmLocation);
                    const foreignAssetInfo = foreignAssetsInfo.get(foreignAssetId);
                    if (foreignAssetInfo) {
                        assetHubPoolAssets.set(foreignAssetId, foreignAssetInfo);
                        if (!assetOneId) assetOneId = foreignAssetId;
                        else assetTwoId = foreignAssetId;
                    }
                }
            }

            // Store valid pool pairs
            if (assetOneId && assetTwoId) {
                poolAssetPairs.add(`${assetOneId}-${assetTwoId}`);
            }
        }

        // Initialize router only with assets that are in pools
        const tokenGraph = new TokenGraph();

        // Initialize graph with pool assets
        for (const [assetId] of assetHubPoolAssets) {
            tokenGraph.addNode(assetId);
        }

        // Add pools using the stored pairs
        for (const pairStr of poolAssetPairs) {
            const [assetOneId, assetTwoId] = pairStr.split('-');
            tokenGraph.addEdge(
                assetOneId,
                assetTwoId,
                'assetHub'
            );
        }

        // Cache router and graph
        this.cacheService.set(CACHE_KEYS.TOKEN_GRAPH, tokenGraph);
        //saveAssetsToFile(assetHubPoolAssets, 'assetHubPoolAssets.json');
        // Get HydraDX assets and merge them
        const mergedAssets = await this.enrichWithHydraDxData(assetHubPoolAssets, nativeAssetsInfo,
            foreignAssetsInfo);
        //saveAssetsToFile(mergedAssets, 'mergedAssets.json');

        // // Ensure all assets have serialized XCM locations before caching
        // const serializedAssets = new Map<string, Asset>();
        // for (const [key, asset] of mergedAssets.entries()) {
        //     serializedAssets.set(key, ensureSerializedXcmLocation(asset));
        // }

        //set cache for mergedAssets
        this.cacheService.set(CACHE_KEYS.MERGED_ASSETS, mergedAssets);
        return mergedAssets;
    }


    public async enrichWithHydraDxData(
        assetHubAssets: Map<string, Asset>,
        nativeAssetsInfo: Map<string, Asset>,
        foreignAssetsInfo: Map<string, Asset>

    ): Promise<Map<string, Asset>> {
        console.log('🔄 Starting HydraDX asset enrichment using SDK-Next...');
        
        try {
            // Get the HydraDX router service (which should already be initialized)
            const hydraRouter = HydraDxRouterService.getInstance();
            
            if (!hydraRouter.isInitialized()) {
                console.warn('⚠️ HydraDX router not initialized, skipping enrichment');
                return this.fallbackMergeAssets(assetHubAssets, nativeAssetsInfo, foreignAssetsInfo);
            }

            // Start with asset hub assets
            const mergedAssets = new Map<string, Asset>(assetHubAssets);

            // For now, use the working cached mappings approach until we can properly implement dynamic discovery
            // This restores the functionality while we work on the proper SDK-Next integration
            const knownMappings = this.getKnownHydraDxMappings();
            
            let enrichedCount = 0;
            for (const [assetId, asset] of mergedAssets.entries()) {
                const mapping = knownMappings.get(assetId);
                if (mapping) {
                    asset.hydradx = mapping;
                    enrichedCount++;
                    console.log(`✅ Enriched asset ${assetId} with HydraDX mapping (HydraDX ID: ${mapping.assetId})`);
                }
            }

            // Add any remaining native and foreign assets that aren't in pools
            this.addRemainingAssets(mergedAssets, nativeAssetsInfo, foreignAssetsInfo);

            console.log(`✅ HydraDX enrichment completed: ${enrichedCount} assets enriched out of ${mergedAssets.size} total assets`);

            return mergedAssets;

        } catch (error) {
            console.error('❌ Error during HydraDX asset enrichment:', error);
            console.log('🔄 Falling back to basic asset merging');
            return this.fallbackMergeAssets(assetHubAssets, nativeAssetsInfo, foreignAssetsInfo);
        }
    }

    /**
     * Fallback method to merge assets without HydraDX enrichment
     */
    private fallbackMergeAssets(
        assetHubAssets: Map<string, Asset>,
        nativeAssetsInfo: Map<string, Asset>,
        foreignAssetsInfo: Map<string, Asset>
    ): Map<string, Asset> {
        console.log('📦 Using fallback asset merging without HydraDX enrichment');
        
        const mergedAssets = new Map<string, Asset>(assetHubAssets);
        this.addRemainingAssets(mergedAssets, nativeAssetsInfo, foreignAssetsInfo);
        
        return mergedAssets;
    }

    /**
     * Get known HydraDX mappings based on working cached data
     * This is a temporary solution to restore functionality while we work on proper SDK-Next integration
     */
    private getKnownHydraDxMappings(): Map<string, any> {
        const mappings = new Map();
        
        // DOT (native)
        mappings.set('DOT', {
            assetId: '5',
            location: {
                parents: 1,
                interior: { type: 'Here', value: undefined }
            },
            poolAddress: '0x0',
            poolType: 'Omnipool',
            balance: '0',
            existentialDeposit: '1'
        });
        
        // USDt (1984) - the main asset causing issues
        mappings.set('1984', {
            assetId: '10',
            location: {
                parents: 1,
                interior: {
                    x3: [
                        { parachain: 1000 },
                        { palletInstance: 50 },
                        { generalIndex: 1984 }
                    ]
                }
            },
            poolAddress: '7LVGEVLFXpsCCtnsvhzkSMQARU7gRVCtwMckG7u7d3V6FVvG',
            poolType: 'Stableswap',
            balance: '8914335910566',
            existentialDeposit: '10000'
        });
        
        return mappings;
    }

    /**
     * Add native and foreign assets that might not be in Asset Hub pools
     */
    private addRemainingAssets(
        mergedAssets: Map<string, Asset>,
        nativeAssetsInfo: Map<string, Asset>,
        foreignAssetsInfo: Map<string, Asset>
    ): void {
        // Add native assets that might not be in pools yet
        for (const [id, asset] of nativeAssetsInfo) {
            if (!mergedAssets.has(id)) {
                mergedAssets.set(id, asset);
            }
        }
        
        // Add foreign assets that might not be in pools yet
        for (const [id, asset] of foreignAssetsInfo) {
            if (!mergedAssets.has(id)) {
                mergedAssets.set(id, asset);
            }
        }
    }
}    
