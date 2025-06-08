#!/usr/bin/env tsx

// Test script to verify @galacticcouncil/sdk-next integration
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { hydration } from '@polkadot-api/descriptors';

async function testSDKNext() {
  console.log('🧪 Testing @galacticcouncil/sdk-next integration...\n');

  try {
    // Test 1: Check if we can import the SDK
    console.log('1️⃣ Testing SDK import...');
    
    let SDK;
    try {
      SDK = await import('@galacticcouncil/sdk-next');
      console.log('✅ SDK import successful');
      console.log('Available exports:', Object.keys(SDK));
    } catch (error) {
      console.log('❌ SDK import failed:', error);
      return;
    }

    // Test 2: Test PAPI connection to HydraDX
    console.log('\n2️⃣ Testing PAPI connection to HydraDX...');
    
    try {
      const endpoint = 'wss://hydration.dotters.network';
      console.log(`Connecting to: ${endpoint}`);
      
      const wsProvider = getWsProvider(endpoint);
      const client = createClient(withPolkadotSdkCompat(wsProvider));
      const hydraDxApi = client.getTypedApi(hydration);
      
      console.log('✅ PAPI connection created successfully');
      
      // Test a simple query
      console.log('Testing basic query...');
      const version = await hydraDxApi.constants.System.Version();
      console.log(`✅ Chain info: ${version.spec_name}`);
      
      // Cleanup
      await client.destroy();
      console.log('✅ Connection cleaned up');
      
    } catch (error) {
      console.log('❌ PAPI connection failed:', error);
    }

    // Test 3: Test SDK functionality (if available)
    console.log('\n3️⃣ Testing SDK functionality...');
    
    try {
      // Check what's available in the SDK
      if (SDK) {
        console.log('SDK exports:', Object.keys(SDK));
        
        // Test if we can create any SDK instances
        if (SDK.PoolService || SDK.TradeRouter || SDK.Router) {
          console.log('✅ SDK classes are available');
        } else {
          console.log('ℹ️ SDK classes not found in current export structure');
        }
      }
    } catch (error) {
      console.log('❌ SDK functionality test failed:', error);
    }

    console.log('\n🎉 SDK-Next test completed!');
    
  } catch (error) {
    console.error('\n❌ Overall test failed:', error);
    process.exit(1);
  }
}

testSDKNext().catch(console.error); 