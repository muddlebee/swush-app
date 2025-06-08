#!/usr/bin/env tsx

// Debug script to examine HydraDX pool data
import { HydraDxRouterService } from '../services/assets/router/HydraDxRouterService';
import { ConnectionManager } from '../services/network/ConnectionManager';

async function debugHydraDxPools() {
    console.log('🔍 Debugging HydraDX Pools...\n');

    try {
        // 1. Initialize ConnectionManager
        console.log('1️⃣ Initializing ConnectionManager...');
        const connectionManager = ConnectionManager.getInstance();
        await connectionManager.initialize();
        console.log('✅ ConnectionManager initialized');

        // 2. Initialize HydraDX Router Service
        console.log('\n2️⃣ Initializing HydraDX Router Service...');
        const hydraRouter = HydraDxRouterService.getInstance();
        await hydraRouter.initialize();
        console.log('✅ HydraDX Router Service initialized');

        // 3. Get and examine pools
        console.log('\n3️⃣ Examining HydraDX pools...');
        const router = hydraRouter.getRouter();
        if (!router) {
            throw new Error('Router not available');
        }

        const pools = await router.getPools();
        console.log(`Found ${pools.length} pools on HydraDX\n`);

        // Look for pools containing asset 10 (which should be USDt)
        let foundAsset10 = false;
        let foundAsset5 = false;

        for (let i = 0; i < pools.length; i++) {
            const pool = pools[i];
            const tokens = (pool as any).tokens || [];
            
            console.log(`Pool ${i}:`, {
                type: (pool as any).type,
                address: (pool as any).address,
                tokenCount: tokens.length
            });

            for (const token of tokens) {
                const assetId = token.id?.toString() || '';
                if (assetId === '10' || assetId === '5') {
                    console.log(`  🎯 Found asset ${assetId}:`, {
                        id: token.id?.toString(),
                        symbol: token.symbol,
                        decimals: token.decimals,
                        location: token.location
                    });
                    
                    if (assetId === '10') foundAsset10 = true;
                    if (assetId === '5') foundAsset5 = true;
                }
            }
            console.log(''); // Empty line for readability
        }

        console.log('Summary:');
        console.log('- Asset 5 (DOT) found in pools:', foundAsset5);
        console.log('- Asset 10 (USDt) found in pools:', foundAsset10);

        if (!foundAsset10) {
            console.log('\n🔍 Listing all asset IDs found in pools:');
            const allAssetIds = new Set<string>();
            for (const pool of pools) {
                const tokens = (pool as any).tokens || [];
                for (const token of tokens) {
                    const assetId = token.id?.toString() || '';
                    if (assetId) allAssetIds.add(assetId);
                }
            }
            console.log('Asset IDs:', Array.from(allAssetIds).sort((a, b) => parseInt(a) - parseInt(b)));
        }

        // 4. Cleanup
        console.log('\n4️⃣ Cleaning up...');
        hydraRouter.reset();
        await connectionManager.disconnect();
        console.log('✅ Cleanup completed');

    } catch (error) {
        console.error('\n❌ Debug failed:', error);
        process.exit(1);
    }
}

// Run the debug
debugHydraDxPools()
    .then(() => {
        console.log('\n🎉 HydraDX pools debug completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Debug failed with error:', error);
        process.exit(1);
    }); 