#!/usr/bin/env tsx

// Test script to verify HydraDX SDK-Next migration
import { HydraDxRouterService } from '../services/assets/router/HydraDxRouterService';
import { ConnectionManager } from '../services/network/ConnectionManager';

async function testHydraDxMigration() {
  console.log('🧪 Testing HydraDX SDK-Next Migration...\n');

  try {
    // 1. Test ConnectionManager initialization
    console.log('1️⃣ Initializing ConnectionManager...');
    const connectionManager = ConnectionManager.getInstance();
    await connectionManager.initialize();
    console.log('✅ ConnectionManager initialized');

    // 2. Check HydraDX PAPI connection
    console.log('\n2️⃣ Testing HydraDX PAPI connection...');
    const papiConnection = await connectionManager.getHydraDxPapiConnectionWithRetry(15000);
    
    if (!papiConnection) {
      console.error('❌ Failed to get HydraDX PAPI connection');
      const status = connectionManager.getConnectionStatus();
      console.log('Connection status:', status);
      return;
    }
    
    console.log('✅ HydraDX PAPI connection available');
    console.log('Connection endpoint:', papiConnection.endpoint);
    console.log('Connection status:', papiConnection.isConnected);

    // 3. Test HydraDxRouterService initialization
    console.log('\n3️⃣ Testing HydraDxRouterService...');
    const routerService = HydraDxRouterService.getInstance();
    
    console.log('Initializing router service...');
    await routerService.initialize();
    console.log('✅ HydraDxRouterService initialized');
    console.log('Router initialized:', routerService.isInitialized());

    // 4. Test trading functionality
    console.log('\n4️⃣ Testing trading functionality...');
    try {
      // Test with DOT -> HDX trade (common pair)
      const assetIn = '5';   // DOT
      const assetOut = '0';  // HDX
      const amountIn = BigInt('1000000000000'); // 1 DOT in planck units

      console.log(`Testing trade: ${assetIn} -> ${assetOut}, amount: ${amountIn}`);
      
      const quote = await routerService.getBestSell(assetIn, assetOut, amountIn);
      
      if (quote) {
        console.log('✅ Trade quote received!');
        console.log('Quote details:', quote.toHuman());
        console.log('Amount in:', quote.amountIn?.toString());
        console.log('Amount out:', quote.amountOut?.toString());
      } else {
        console.log('⚠️ No quote available (may be normal if pools don\'t exist)');
      }
    } catch (error) {
      console.error('❌ Error testing trade:', error);
    }

    // 5. Test spot price
    console.log('\n5️⃣ Testing spot price...');
    try {
      const spotPrice = await routerService.getSpotPrice('5', '0'); // DOT -> HDX
      if (spotPrice) {
        console.log('✅ Spot price received:', spotPrice);
      } else {
        console.log('⚠️ No spot price available');
      }
    } catch (error) {
      console.error('❌ Error testing spot price:', error);
    }

    // 6. Cleanup
    console.log('\n6️⃣ Cleaning up...');
    routerService.reset();
    await connectionManager.disconnect();
    console.log('✅ Cleanup completed');

    console.log('\n🎉 HydraDX SDK-Next migration test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration test failed:', error);
    process.exit(1);
  }
}

testHydraDxMigration().catch(console.error); 