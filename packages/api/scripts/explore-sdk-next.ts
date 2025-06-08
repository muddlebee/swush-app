#!/usr/bin/env tsx

// Script to explore @galacticcouncil/sdk-next capabilities
import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { hydration } from '@polkadot-api/descriptors';
import * as SDK from '@galacticcouncil/sdk-next';

async function exploreSDK() {
  console.log('🔍 Exploring @galacticcouncil/sdk-next capabilities...\n');

  try {
    // 1. Explore SDK structure
    console.log('1️⃣ SDK Structure:');
    Object.keys(SDK).forEach(key => {
      const value = (SDK as any)[key];
      console.log(`  ${key}: ${typeof value}`);
      
      if (typeof value === 'object' && value !== null) {
        const subKeys = Object.keys(value);
        if (subKeys.length > 0 && subKeys.length < 10) {
          console.log(`    - ${subKeys.join(', ')}`);
        } else if (subKeys.length > 0) {
          console.log(`    - ${subKeys.length} properties`);
        }
      }
    });

    // 2. Test connection with SDK
    console.log('\n2️⃣ Testing SDK with PAPI connection...');
    
    const endpoint = 'wss://hydration.dotters.network';
    const wsProvider = getWsProvider(endpoint);
    const client = createClient(withPolkadotSdkCompat(wsProvider));
    const api = client.getTypedApi(hydration);
    
    // 3. Test pool functionality
    console.log('\n3️⃣ Testing pool functionality...');
    if (SDK.pool) {
      console.log('Available pool functions:');
      Object.keys(SDK.pool).forEach(key => {
        console.log(`  - pool.${key}: ${typeof (SDK.pool as any)[key]}`);
      });
    }
    
    // 4. Test SOR (Smart Order Router) functionality
    console.log('\n4️⃣ Testing SOR functionality...');
    if (SDK.sor) {
      console.log('Available SOR functions:');
      Object.keys(SDK.sor).forEach(key => {
        console.log(`  - sor.${key}: ${typeof (SDK.sor as any)[key]}`);
      });
    }

    // 5. Test API helpers
    console.log('\n5️⃣ Testing API helpers...');
    if (SDK.api) {
      console.log('Available API helpers:');
      Object.keys(SDK.api).forEach(key => {
        console.log(`  - api.${key}: ${typeof (SDK.api as any)[key]}`);
      });
    }

    // 6. Test client creation
    console.log('\n6️⃣ Testing client functionality...');
    if (SDK.client) {
      console.log('Available client functions:');
      Object.keys(SDK.client).forEach(key => {
        console.log(`  - client.${key}: ${typeof (SDK.client as any)[key]}`);
      });
    }

    // Cleanup
    await client.destroy();
    console.log('\n✅ SDK exploration completed successfully!');
    
  } catch (error) {
    console.error('❌ SDK exploration failed:', error);
    process.exit(1);
  }
}

exploreSDK().catch(console.error); 