#!/usr/bin/env tsx

// Test script to check HydraDX router service directly
import { HydraDxRouterService } from '../services/assets/router/HydraDxRouterService';
import { ConnectionManager } from '../services/network/ConnectionManager';
import { FetchAssetService } from '../services/assets/FetchAssetService';

async function testHydraDxRouting() {
    console.log('🧪 Testing HydraDX Router Service for DOT->USDt...\n');

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
        console.log('Is initialized:', hydraRouter.isInitialized());

        // 3. Initialize Asset Service
        console.log('\n3️⃣ Initializing Asset Service...');
        const assetService = FetchAssetService.getInstance();
        await assetService.initialize();
        console.log('✅ Asset Service initialized');

        // 4. Get assets and find DOT and USDt
        console.log('\n4️⃣ Fetching assets...');
        const assets = await assetService.getAssets();
        const dotAsset = assets.get('DOT');
        const usdtAsset = assets.get('1984');

        console.log('DOT asset found:', !!dotAsset);
        console.log('DOT HydraDX info:', dotAsset?.hydradx);
        console.log('USDt asset found:', !!usdtAsset);
        console.log('USDt HydraDX info:', usdtAsset?.hydradx);

        if (!dotAsset?.hydradx || !usdtAsset?.hydradx) {
            console.error('❌ Assets missing HydraDX information');
            return;
        }

        // 5. Test quote
        console.log('\n5️⃣ Testing HydraDX quote...');
        const amountIn = BigInt('7777444444442244'); // DOT has 10 decimals
        
        console.log('Getting quote for:', {
            fromAssetId: dotAsset.hydradx.assetId,
            toAssetId: usdtAsset.hydradx.assetId,
            amountIn: amountIn.toString()
        });

        const quote = await hydraRouter.getBestSell(
            dotAsset.hydradx.assetId,
            usdtAsset.hydradx.assetId,
            amountIn
        );

        if (quote) {
            console.log('✅ HydraDX quote received!');
            console.log('Quote details:', quote.toHuman());
            console.log('Amount out:', quote.amountOut?.toString());
        } else {
            console.log('❌ No quote received from HydraDX');
        }

        // 6. Cleanup
        console.log('\n6️⃣ Cleaning up...');
        hydraRouter.reset();
        await connectionManager.disconnect();
        console.log('✅ Cleanup completed');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testHydraDxRouting()
    .then(() => {
        console.log('\n🎉 HydraDX routing test completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Test failed with error:', error);
        process.exit(1);
    }); 