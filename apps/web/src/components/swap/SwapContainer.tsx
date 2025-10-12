"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { SwapHeader } from '@/components/swap/ui/SwapHeader'
import { HeaderActions } from '@/components/swap/ui/SwapHeader'
import { SwapField } from '@/components/swap/ui/SwapField'
import { SwapDetails } from '@/components/swap/ui/SwapDetails'
import { SubmitButtonAction } from '@/components/swap/ui/SwapAction'
import { SwapConfirmSheet } from '@/components/swap/ui/SwapConfirmSheet'
import { SwapHistoryDialog } from '@/components/swap/ui/SwapHistoryDialog'
import { useXcmTokens } from '@/components/swap/hooks/useXcmTokens'
import { useTokenBalances } from '@/components/swap/hooks/useTokenBalances'
import { useXcmRoute } from '@/components/swap/hooks/useXcmRoute'
import { useAssetConversionSwap } from '@/components/swap/hooks/useAssetConversionSwap'
import { useSwapConfirmation } from '@/components/swap/hooks/useSwapConfirmation'
import { useSwapExecution } from '@/components/swap/hooks/useSwapExecution'
import { useSwapHistory } from '@/components/swap/hooks/useSwapHistory'
import { LoadState } from '@/components/swap/ui/LoadState'
import { ArrowSymbolDown } from '@/components/swap/ui/ArrowSymbolDown'
import { calculateMinimumReceived } from '@/components/swap/utils'
import { SwapCompleteDialog } from './ui/SwapCompleteDialog'

export function SwapContainer() {
  // UI state
  const [inputAmount, setInputAmount] = useState('')
  const [slippageTolerance, setSlippageTolerance] = useState(10)
  const [insufficientBalance, setInsufficientBalance] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [openInputDialog, setOpenInputDialog] = useState(false)
  const [openOutputDialog, setOpenOutputDialog] = useState(false)

  // Initialize wallet state first to avoid circular dependencies
  const [isConnected, setIsConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')

  // Custom hooks - Token and Balance handling (nuqs handles URL params automatically)
  const { 
    inputToken, 
    setInputToken, 
    outputToken, 
    setOutputToken, 
    // ✅ Separate token lists for input/output fields
    fromTokens,
    toTokens,
    // ✅ Loading state
    isInitialLoad,
    // Expose helpers for Phase 2 (routing)
    getOptimalExchanges,
    determineCurrency,
    getTAssetFromKey,
    // For debugging/inspection (can be removed later)
    unifiedFromAssets,
    unifiedToAssets,
  } = useXcmTokens()

  // Token balances
  const {
    inputBalance,
    outputBalance,
    isBalanceLoading,
    balancesLoaded,
    resetBalances,
    refreshBalances
  } = useTokenBalances({
    isConnected,
    walletAddress,
    inputToken,
    outputToken
  })

  // Handle wallet disconnect
  const handleDisconnect = useCallback(() => {
    setIsConnected(false);
    setWalletAddress('');
    resetBalances();
  }, [resetBalances]);

  // Swap route - now using real ParaSpell RouterBuilder with parallel fetching
  const {
    outputAmount,
    routeDex,
    routeState,
    estimatedFees,
    feeBreakdown,
    debouncedFetchRoute,
    isProcessing,
    isLoadingQuote,
    isLoadingFees,
    resetRoute
  } = useXcmRoute({
    inputToken,
    outputToken,
    walletAddress,
    slippageTolerance,
    // Pass helpers from useXcmTokens
    getOptimalExchanges,
    determineCurrency,
    getTAssetFromKey,
  })

  // Swap state
  const [isSwapping, setIsSwapping] = useState(false)

  // Swap confirmation
  const {
    showConfirmation,
    simulationResult,
    isConfirmingSwap,
    isSwapComplete,
    isSwappingInProgress,
    setShowConfirmation,
    handleSimulationComplete,
    handleConfirmSwap,
    handleCancelSwap,
    resetConfirmationState
  } = useSwapConfirmation({
    setIsSwapping
  });

  // Handle balance updates after swap
  const handleBalanceUpdateNeeded = useCallback((txHash?: string) => {
    // Use the simplified refresh approach
    refreshBalances(true, txHash);
  }, [refreshBalances]);

  // Asset conversion swap hook with simulation callback
  // TODO Phase 3: Update this to use new route data structure
  const {
    executeSwap: executeAssetConversionSwap,
    isFinalized
  } = useAssetConversionSwap({
    inputToken,
    outputToken,
    walletAddress,
    slippageTolerance,
    inputAmount,
    outputAmount,
    routeState: {
      ...routeState,
      data: routeState.data as any // Type compatibility for Phase 2 - will update in Phase 3
    },
    onSuccess: () => {
      // Reset all swap-related states
      setInputAmount('');
      resetRoute(); // This will reset the output amount and route state

      // Reset confirmation UI state
      resetConfirmationState();
    },
    onError: (error) => {
      // Reset all swap-related states
      setInputAmount('');
      resetRoute();
      setIsSwapping(false);
      resetConfirmationState();
    },
    onSimulationComplete: handleSimulationComplete,
    onBalanceUpdateNeeded: handleBalanceUpdateNeeded
  });

  // Swap execution handling
  const { handleSwapExecution } = useSwapExecution({
    inputToken,
    outputToken,
    inputAmount,
    insufficientBalance,
    executeAssetConversionSwap,
    setIsSwapping,
    setIsConfirmingSwap: resetConfirmationState
  });

  // Handle wallet disconnect with confirmation state cleanup
  const handleWalletDisconnect = useCallback(() => {
    handleDisconnect();
    resetBalances();
    if (showConfirmation) {
      resetConfirmationState();
    }
    // Reset route state
    resetRoute();
    // Reset input amount
    setInputAmount('');
  }, [handleDisconnect, showConfirmation, resetConfirmationState, resetBalances, resetRoute]);

  // Effect to reset states when tokens change
  useEffect(() => {
    // Reset amounts and route state
    setInsufficientBalance(false);

    // Only fetch route if we have an input amount (not just token selection)
    if (inputToken && outputToken && inputAmount && parseFloat(inputAmount) > 0) {
      debouncedFetchRoute(inputAmount);
    } else {
      // Clear route when tokens change but no amount - prevents loading state on token selection
      resetRoute();
    }
  }, [inputToken, outputToken, inputAmount, debouncedFetchRoute, resetRoute]);

  // Event handlers
  const handleInputChange = useCallback((value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setInputAmount(value);

      if (value && parseFloat(value) > 0) {
        debouncedFetchRoute(value);
      } else {
        // Cancel any pending debounced calls and reset route when input is cleared or zero
        debouncedFetchRoute.cancel();
        resetRoute();
      }

      setInsufficientBalance(value !== '' && parseFloat(value) > parseFloat(inputBalance));
    }
  }, [debouncedFetchRoute, inputBalance, resetRoute]);

  const percentageOptions = useMemo(() => [
    { label: '25%', value: 0.25 },
    { label: '50%', value: 0.50 },
    // { label: '75%', value: 0.75 },
    { label: 'MAX', value: 1 },
  ], []);

  // Swap history hook
  const { swapHistory, isLoadingHistory } = useSwapHistory({
    walletAddress,
    showHistory
  });

  // Show loading state only during initial asset loading
  // Once assets load once, show the UI even if they become empty later
  if (isInitialLoad) {
    return <LoadState />
  }

  return (
    <>

      {/* Main Content */}
      <div className="w-full h-full flex flex-col items-center pt-16 sm:-top-10 sm:justify-center px-4 md:px-4 relative z-10 overflow-y-scroll no-scrollbar">
        <div className="w-full max-w-md space-y-5 md:space-y-4">
          <SwapHeader
            slippageTolerance={slippageTolerance}
            setSlippageTolerance={setSlippageTolerance}
            onHistoryClick={() => setShowHistory(true)}
          />

          <div className="space-y-4">
            <div className="">
              <SwapField
                type="input"
                token={inputToken}
                amount={inputAmount}
                balance={inputBalance}
                onTokenSelect={(token) => {
                  setInputToken(token)
                }}
                onAmountChange={handleInputChange}
                openDialog={openInputDialog}
                setOpenDialog={setOpenInputDialog}
                availableTokens={fromTokens}
                percentageOptions={percentageOptions}
                onPercentageSelect={(value) => handleInputChange((parseFloat(inputBalance) * value).toString())}
                isLoading={isConnected && isBalanceLoading}
                balancesLoaded={balancesLoaded}
                isConnected={isConnected}
              />

              <ArrowSymbolDown />

              <SwapField
                type="output"
                token={outputToken}
                amount={outputAmount}
                balance={outputBalance}
                onTokenSelect={(token) => {
                  setOutputToken(token)
                }}
                openDialog={openOutputDialog}
                setOpenDialog={setOpenOutputDialog}
                availableTokens={toTokens}
                isLoading={isLoadingQuote || (isConnected && isBalanceLoading)}
                balancesLoaded={balancesLoaded}
                isConnected={isConnected}
                isProcessing={isLoadingQuote}
                error={routeState.error}
              />
            </div>

            <SwapDetails
              minimumReceived={calculateMinimumReceived(outputAmount, slippageTolerance)}
              outputToken={outputToken}
              inputToken={inputToken}
              maxTransactionFee={estimatedFees || simulationResult?.estimatedFee || '0'}
              feeBreakdown={feeBreakdown || simulationResult?.feeBreakdown}
              route={routeDex || ''}
              isLoading={routeState.isLoading}
              isProcessing={isProcessing}
              isLoadingQuote={isLoadingQuote}
              isLoadingFees={isLoadingFees}
            />

            <SubmitButtonAction
              isSwapping={isSwapping}
              onSwap={() => {
                setShowConfirmation(true);
                // handleSwapExecution(isConnected)
              }}
              disabled={!inputAmount || inputAmount === '' || parseFloat(inputAmount) <= 0 || !outputAmount || outputAmount === ''}
              isLoadingQuote={isLoadingQuote}
            />
          </div>
        </div>
      </div>

      {/* History Dialog */}
      <SwapHistoryDialog
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        swapHistory={swapHistory}
        isLoadingHistory={isLoadingHistory}
      />

      {/* Swap Confirmation Bottom Sheet */}
      <SwapConfirmSheet
        isOpen={showConfirmation}
        onClose={handleCancelSwap}
        onConfirm={handleConfirmSwap}
        inputAmount={inputAmount}
        inputToken={inputToken?.symbol || ''}
        outputAmount={outputAmount}
        outputToken={outputToken?.symbol || ''}
        slippageTolerance={slippageTolerance}
        simulationResult={simulationResult}
        isConfirming={isConfirmingSwap}
      />

      <SwapCompleteDialog 
        isOpen={isSwappingInProgress || isSwapComplete}
        isSwappingInProgress={isSwappingInProgress}
        isSwapComplete={isSwapComplete}
        inputAmount={inputAmount}
        inputToken={inputToken?.symbol || ''}
        outputAmount={outputAmount}
        outputToken={outputToken?.name || ''}
        duration={4000}
        onClose={resetConfirmationState}
      />
    </>
  )
} 