#!/usr/bin/env tsx

// Test script to understand SDK-Next TradeRouter API
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { hydration } from '@polkadot-api/descriptors';
import * as SDK from '@galacticcouncil/sdk-next';

async function testTradeRouter() {
  console.log('🧪 Testing SDK-Next TradeRouter API...\n');

  try {
    // Set up PAPI connection
    const endpoint = 'wss://hydration.dotters.network';
    const wsProvider = getWsProvider(endpoint);
    const client = createClient(withPolkadotSdkCompat(wsProvider));
    const api = client.getTypedApi(hydration);
    
    console.log('✅ PAPI connection established');

    // Test Router creation
    console.log('\n1️⃣ Testing Router creation...');
    const router = new SDK.sor.Router(api);
    console.log('✅ Router created:', typeof router);
    console.log('Router methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(router)));

    // Test TradeRouter creation  
    console.log('\n2️⃣ Testing TradeRouter creation...');
    const tradeRouter = new SDK.sor.TradeRouter(api);
    console.log('✅ TradeRouter created:', typeof tradeRouter);
    console.log('TradeRouter methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(tradeRouter)));

    // Test getBestSell method signature
    console.log('\n3️⃣ Testing getBestSell method...');
    try {
      // Test with known asset IDs (using DOT and HDX)
      const assetIn = '5'; // DOT
      const assetOut = '0'; // HDX  
      const amountIn = BigInt('1000000000000'); // 1 DOT in planck units
      
      console.log(`Testing: ${assetIn} → ${assetOut}, amount: ${amountIn}`);
      
      const result = await tradeRouter.getBestSell(assetIn, assetOut, amountIn);
      console.log('✅ getBestSell result type:', typeof result);
      console.log('Result:', result);
      
      if (result) {
        console.log('Result properties:', Object.keys(result));
        if (typeof result.toHuman === 'function') {
          console.log('Human readable:', result.toHuman());
        }
      }
    } catch (error) {
      console.log('❌ getBestSell error:', error);
    }

    // Test asset types
    console.log('\n4️⃣ Testing asset ID types...');
    try {
      // Test with different parameter types
      const tests = [
        { assetIn: '5', assetOut: '0', amount: '1000000000000' }, // strings
        { assetIn: 5, assetOut: 0, amount: 1000000000000 }, // numbers
        { assetIn: '5', assetOut: '0', amount: BigInt('1000000000000') }, // mixed
      ];

      for (const test of tests) {
        try {
          console.log(`Testing types: ${typeof test.assetIn}, ${typeof test.assetOut}, ${typeof test.amount}`);
          const result = await tradeRouter.getBestSell(test.assetIn, test.assetOut, test.amount);
          console.log(`✅ Success with types: ${typeof test.assetIn}, ${typeof test.assetOut}, ${typeof test.amount}`);
          break; // Stop on first success
        } catch (error) {
          console.log(`❌ Failed with types: ${typeof test.assetIn}, ${typeof test.assetOut}, ${typeof test.amount}`, error.message);
        }
      }
    } catch (error) {
      console.log('❌ Asset type test error:', error);
    }

    await client.destroy();
    console.log('\n🎉 SDK-Next TradeRouter test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testTradeRouter().catch(console.error); 