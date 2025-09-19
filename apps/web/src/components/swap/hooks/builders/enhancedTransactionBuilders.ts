import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub, hydration } from '@polkadot-api/descriptors';
import type { Transaction } from 'polkadot-api';
import { FrontendConnectionManager } from '@/services/FrontendConnectionManager';
import { XcmDryRunService, XcmDryRunResult, ChainExecutionResult, DryRunOptions } from '@/services/xcm/XcmDryRunService';
import { 
  buildAssetHubTransaction,
  buildHydraDxTransaction 
} from './transactionBuilders';
import { AssetsMap } from '../types';
// Import modular fee calculation function
import { calculateEstimatedFees } from '../utils/feeUtils';
import { NETWORKS_SUPPORTED } from '@/services/constants';

/**
 * Enhanced Transaction Builders with Modular Fee Calculation
 * 
 * Architecture:
 * - PRIMARY: Uses proven hardcoded fees from feeUtils.ts for fast, reliable calculation
 * - OPTIONAL: Dry run infrastructure available for future precision enhancements
 * - Dry run is NOT in active flow unless explicitly enabled via performDryRun: true
 * - Follows modular design principles per TypeScript guidelines
 * 
 * Fee Calculation Strategy:
 * - Asset Hub: Base transaction fee only
 * - HydraDX: Base fee + comprehensive XCM fees (proven from production)
 * - Future Enhancement: Add dry run precision via useDryRunForFees flag
 */

// Enhanced result types
export interface EnhancedTransactionResult {
  transaction: Transaction<any, any, any, any>;
  dryRunResult?: XcmDryRunResult | ChainExecutionResult;
  dexType: typeof NETWORKS_SUPPORTED.ASSET_HUB | typeof NETWORKS_SUPPORTED.HYDRA_DX;
  estimatedSuccess: boolean;
  totalEstimatedFees: bigint;
  simulationDuration?: number;
}

export interface TransactionBuildOptions {
  performDryRun?: boolean;
  dryRunOptions?: DryRunOptions;
  fallbackOnDryRunFailure?: boolean;
  // Future enhancement flag for precision fee calculation via dry run
  useDryRunForFees?: boolean; // Currently defaults to false - not in active flow
}

/**
 * Enhanced Asset Hub transaction builder with integrated dry run
 */
export const buildEnhancedAssetHubTransaction = async (
  assetHubApi: TypedApi<typeof polkadot_asset_hub>,
  assetsMap: AssetsMap,
  inputAssetId: string,
  outputAssetId: string,
  inputAmountPlanck: bigint,
  minOutputAmountPlanck: bigint,
  walletAddress: string,
  routePath?: string[],
  options: TransactionBuildOptions = {}
): Promise<EnhancedTransactionResult> => {
  const startTime = Date.now();
  
  try {
    // Build the base Asset Hub transaction
    const transaction = await buildAssetHubTransaction(
      assetHubApi,
      assetsMap,
      inputAssetId,
      outputAssetId,
      inputAmountPlanck,
      minOutputAmountPlanck,
      walletAddress,
      routePath
    );

    // PRIMARY: Use modular fee calculation from feeUtils for reliable and fast calculation
    const feeData = calculateEstimatedFees(NETWORKS_SUPPORTED.ASSET_HUB);
    const totalEstimatedFees = BigInt(feeData.estimatedFee);
    
    let dryRunResult: ChainExecutionResult | undefined;
    let estimatedSuccess = true; // Asset Hub transactions are generally reliable

    // OPTIONAL: Perform dry run for validation only (not for fee calculation)
    // This is not in the active flow unless explicitly enabled
    if (options.performDryRun === true) {
      try {
        const dryRunService = XcmDryRunService.getInstance();
        dryRunResult = await dryRunService.dryRunAssetHubTransaction(
          assetHubApi,
          transaction,
          walletAddress,
          {
            verbose: options.dryRunOptions?.verbose || false,
            timeoutMs: options.dryRunOptions?.timeoutMs || 30000,
            xcmVersion: options.dryRunOptions?.xcmVersion || 4
          }
        );

        // Use dry run result for success validation, but not for fees
        estimatedSuccess = dryRunResult.success;

        if (options.dryRunOptions?.verbose) {
          console.log('🔍 Asset Hub transaction dry run validation:', {
            success: estimatedSuccess,
            hardcodedFees: totalEstimatedFees.toString(),
            dryRunFees: dryRunResult.fees?.toString() || 'N/A',
            hasCompatibilityWarning: dryRunResult.error?.includes('DryRunApi') || false
          });
        }

        // Log compatibility warnings
        if (dryRunResult.success && dryRunResult.error?.includes('DryRunApi')) {
          console.warn('⚠️ Using fallback validation due to DryRunApi compatibility:', dryRunResult.error);
        }

      } catch (error) {
        console.warn('Asset Hub dry run validation failed:', error);
        
        if (!options.fallbackOnDryRunFailure) {
          throw new Error(`Dry run validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Fallback: proceed with modular fees and assume success
        console.log('Falling back to modular fees without dry run validation');
        estimatedSuccess = true;
      }
    }

    return {
      transaction,
      dryRunResult,
      dexType: NETWORKS_SUPPORTED.ASSET_HUB,
      estimatedSuccess,
      totalEstimatedFees, // Always use modular fee calculation
      simulationDuration: Date.now() - startTime
    };

  } catch (error) {
    console.error('Enhanced Asset Hub transaction building failed:', error);
    throw new Error(`Failed to build enhanced Asset Hub transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Enhanced HydraDX transaction builder with comprehensive XCM dry run
 */
export const buildEnhancedHydraDxTransaction = async (
  assetHubApi: TypedApi<typeof polkadot_asset_hub>,
  assetsMap: AssetsMap,
  inputAssetId: string,
  outputAssetId: string,
  inputAmountPlanck: bigint,
  minOutputAmountPlanck: bigint,
  alicePublicKey: Uint8Array,
  walletAddress: string,
  options: TransactionBuildOptions = {}
): Promise<EnhancedTransactionResult> => {
  const startTime = Date.now();
  
  try {
    // Build the base HydraDX XCM transaction
    const transaction = await buildHydraDxTransaction(
      assetHubApi,
      assetsMap,
      inputAssetId,
      outputAssetId,
      inputAmountPlanck,
      minOutputAmountPlanck,
      alicePublicKey,
      walletAddress
    );

    // PRIMARY: Use modular fee calculation from feeUtils for reliable and fast calculation
    const feeData = calculateEstimatedFees(NETWORKS_SUPPORTED.HYDRA_DX);
    const totalEstimatedFees = BigInt(feeData.estimatedFee);

    let dryRunResult: XcmDryRunResult | undefined;
    let estimatedSuccess = true; // HydraDX transactions are generally reliable with proven parameters

    // OPTIONAL: Perform comprehensive XCM dry run for validation only (not for fee calculation)
    // This is not in the active flow unless explicitly enabled
    if (options.performDryRun === true) {
      try {
        // Get HydraDX connection for comprehensive testing
        const hydraDxConnection = await FrontendConnectionManager.getInstance().getConnection(NETWORKS_SUPPORTED.HYDRA_DX);
        
        if (!hydraDxConnection || !hydraDxConnection.api) {
          throw new Error('HydraDX connection not available for dry run validation');
        }

        const hydraDxApi = hydraDxConnection.api as TypedApi<typeof hydration>;
        const dryRunService = XcmDryRunService.getInstance();

        // Perform comprehensive XCM dry run for validation
        dryRunResult = await dryRunService.dryRunHydraDxXcmTransaction(
          assetHubApi,
          hydraDxApi,
          transaction,
          walletAddress,
          {
            includeHydraDx: true,
            includeReturnPath: true,
            verbose: options.dryRunOptions?.verbose || false,
            timeoutMs: options.dryRunOptions?.timeoutMs || 60000,
            xcmVersion: options.dryRunOptions?.xcmVersion || 4,
            ...options.dryRunOptions
          }
        );

        // Use dry run result for success validation, but not for fees
        estimatedSuccess = dryRunResult.overallSuccess;

        if (options.dryRunOptions?.verbose) {
          console.log('🚀 HydraDX XCM transaction dry run validation:', {
            overallSuccess: estimatedSuccess,
            assetHubSuccess: dryRunResult.assetHubExecution.success,
            hydraDxSuccess: dryRunResult.hydraDxExecution?.success,
            returnPathSuccess: dryRunResult.returnExecution?.success,
            hardcodedFees: totalEstimatedFees.toString(),
            dryRunFees: dryRunResult.totalEstimatedFees.toString(),
            duration: dryRunResult.estimatedDuration
          });
        }

        // Log detailed results for debugging
        if (!estimatedSuccess) {
          console.warn('HydraDX XCM dry run detected potential validation issues:', {
            assetHubError: dryRunResult.assetHubExecution.error,
            hydraDxError: dryRunResult.hydraDxExecution?.error,
            returnError: dryRunResult.returnExecution?.error,
            generalError: dryRunResult.error
          });
        }

      } catch (error) {
        console.warn('HydraDX XCM dry run validation failed:', error);
        
        if (!options.fallbackOnDryRunFailure) {
          throw new Error(`XCM dry run validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Fallback: proceed with modular fees and assume success
        console.log('Falling back to modular fees without comprehensive XCM validation');
        estimatedSuccess = true;
      }
    }

    return {
      transaction,
      dryRunResult,
      dexType: NETWORKS_SUPPORTED.HYDRA_DX,
      estimatedSuccess,
      totalEstimatedFees, // Always use modular fee calculation
      simulationDuration: Date.now() - startTime
    };

  } catch (error) {
    console.error('Enhanced HydraDX transaction building failed:', error);
    throw new Error(`Failed to build enhanced HydraDX transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Universal enhanced transaction builder that automatically selects the appropriate DEX
 */
export const buildEnhancedTransaction = async (
  assetHubApi: TypedApi<typeof polkadot_asset_hub>,
  assetsMap: AssetsMap,
  inputAssetId: string,
  outputAssetId: string,
  inputAmountPlanck: bigint,
  minOutputAmountPlanck: bigint,
  walletAddress: string,
  dexType: typeof NETWORKS_SUPPORTED.ASSET_HUB | typeof NETWORKS_SUPPORTED.HYDRA_DX,
  routePath?: string[],
  alicePublicKey?: Uint8Array,
  options: TransactionBuildOptions = {}
): Promise<EnhancedTransactionResult> => {
  
  if (dexType === NETWORKS_SUPPORTED.ASSET_HUB) {
    return buildEnhancedAssetHubTransaction(
      assetHubApi,
      assetsMap,
      inputAssetId,
      outputAssetId,
      inputAmountPlanck,
      minOutputAmountPlanck,
      walletAddress,
      routePath,
      options
    );
  } else {
    if (!alicePublicKey) {
      throw new Error('alicePublicKey is required for HydraDX transactions');
    }
    
    return buildEnhancedHydraDxTransaction(
      assetHubApi,
      assetsMap,
      inputAssetId,
      outputAssetId,
      inputAmountPlanck,
      minOutputAmountPlanck,
      alicePublicKey,
      walletAddress,
      options
    );
  }
};

/**
 * Quick dry run validation utility
 */
export const validateTransactionQuickly = async (
  assetHubApi: TypedApi<typeof polkadot_asset_hub>,
  transaction: Transaction<any, any, any, any>,
  walletAddress: string,
  xcmVersion: number = 4
): Promise<boolean> => {
  try {
    const dryRunService = XcmDryRunService.getInstance();
    return await dryRunService.quickDryRun(assetHubApi, transaction, walletAddress, xcmVersion);
  } catch {
    // If quick validation fails, return false to be safe
    return false;
  }
};

/**
 * Enhanced simulation result for UI consumption
 */
export interface SimulationSummary {
  willSucceed: boolean;
  estimatedFees: bigint; // Keep as raw bigint - formatting happens in useAssetConversionSwap
  breakdown: {
    assetHub?: { success: boolean; fees?: bigint; error?: string };
    hydraDx?: { success: boolean; fees?: bigint; error?: string };
    returnPath?: { success: boolean; fees?: bigint; error?: string };
  };
  totalDuration?: number;
  recommendations?: string[];
}

/**
 * Creates a user-friendly simulation summary from dry run results
 * Note: Fee estimates use proven hardcoded values from feeUtils.ts modular calculation
 * Raw bigint values are returned - formatting happens in useAssetConversionSwap
 */
export const createSimulationSummary = (
  result: EnhancedTransactionResult,
  inputTokenDecimals: number = 10
): SimulationSummary => {
  const summary: SimulationSummary = {
    willSucceed: result.estimatedSuccess,
    estimatedFees: result.totalEstimatedFees, // Raw bigint - no redundant formatting
    breakdown: {},
    totalDuration: result.simulationDuration,
    recommendations: []
  };

  // Handle Asset Hub results
  if (result.dexType === NETWORKS_SUPPORTED.ASSET_HUB && result.dryRunResult) {
    const ahResult = result.dryRunResult as ChainExecutionResult;
    summary.breakdown.assetHub = {
      success: ahResult.success,
      fees: ahResult.fees, // Raw bigint
      error: ahResult.error
    };
  }

  // Handle HydraDX XCM results
  if (result.dexType === NETWORKS_SUPPORTED.HYDRA_DX && result.dryRunResult) {
    const xcmResult = result.dryRunResult as XcmDryRunResult;
    
    summary.breakdown.assetHub = {
      success: xcmResult.assetHubExecution.success,
      fees: xcmResult.assetHubExecution.fees, // Raw bigint
      error: xcmResult.assetHubExecution.error
    };

    if (xcmResult.hydraDxExecution) {
      summary.breakdown.hydraDx = {
        success: xcmResult.hydraDxExecution.success,
        fees: xcmResult.hydraDxExecution.fees, // Raw bigint
        error: xcmResult.hydraDxExecution.error
      };
    }

    if (xcmResult.returnExecution) {
      summary.breakdown.returnPath = {
        success: xcmResult.returnExecution.success,
        fees: xcmResult.returnExecution.fees, // Raw bigint
        error: xcmResult.returnExecution.error
      };
    }
  }

  // Add recommendations based on results
  if (!summary.willSucceed) {
    summary.recommendations?.push('Transaction may fail. Consider reviewing parameters.');
    
    if (summary.breakdown.assetHub && !summary.breakdown.assetHub.success) {
      summary.recommendations?.push('Asset Hub execution failed. Check asset balances and permissions.');
    }
    
    if (summary.breakdown.hydraDx && !summary.breakdown.hydraDx.success) {
      summary.recommendations?.push('HydraDX execution failed. Check liquidity and slippage tolerance.');
    }
    
    if (summary.breakdown.returnPath && !summary.breakdown.returnPath.success) {
      summary.recommendations?.push('Return path failed. Assets may be locked on HydraDX.');
    }
  }

  // Add compatibility warnings
  if (summary.breakdown.assetHub?.error?.includes('DryRunApi')) {
    summary.recommendations?.push('Using fallback validation due to runtime compatibility.');
  }

  return summary;
}; 