"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { SwapHeader } from '@/components/swap/ui/SwapHeader'
import { SwapField } from '@/components/swap/ui/SwapField'
import { SwapDetails } from '@/components/swap/ui/SwapDetails'
import { SubmitButtonAction } from '@/components/swap/ui/SwapAction'
import { SwapConfirmSheet } from '@/components/swap/ui/SwapConfirmSheet'
import { SwapHistoryDialog } from '@/components/swap/ui/SwapHistoryDialog'
import { useXcmTokens } from '@/components/swap/hooks/useXcmTokens'
import { useXcmRoute } from '@/components/swap/hooks/useXcmRoute'
import { useXcmSwapExecution } from '@/components/swap/hooks/useXcmSwapExecution'
import { useSwapFlow } from '@/components/swap/hooks/useSwapFlow'
import { useSwapHistory } from '@/components/swap/hooks/useSwapHistory'
import { useParaSpellBalances } from '@/components/swap/hooks/useParaSpellBalances'
import { LoadState } from '@/components/swap/ui/LoadState'
import { ArrowSymbolDown } from '@/components/swap/ui/ArrowSymbolDown'
import { calculateMinimumReceived } from '@/components/swap/utils'
import { SwapCompleteDialog } from './ui/SwapCompleteDialog'
import ConnectWalletDialog from './ui/ConnectWalletDialog'
import SelectRecipientDialog from './ui/SelectRecipientDialog'
import { useSelectedAccount } from '@/components/wallet/use-selected-account'

export function SwapContainer() {
  // UI state
  const [inputAmount, setInputAmount] = useState('')
  const [slippageTolerance, setSlippageTolerance] = useState(10)
  const [insufficientBalance, setInsufficientBalance] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [openInputDialog, setOpenInputDialog] = useState(false)
  const [openOutputDialog, setOpenOutputDialog] = useState(false)
  const [isConnectWalletOpen, setIsConnectWalletOpen] = useState(false)
  const [isSelectRecipientOpen, setIsSelectRecipientOpen] = useState(false)

  // Get selected account from global hook
  const { selectedAccount } = useSelectedAccount()
  const isConnected = !!selectedAccount
  const walletAddress = selectedAccount?.address || ''
  // Get polkadotSigner - only available for Polkadot accounts
  const polkadotSigner = selectedAccount && 'polkadotSigner' in selectedAccount 
    ? selectedAccount.polkadotSigner 
    : undefined

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

  // Balance fetching using ParaSpell SDK
  const {
    inputBalance,
    outputBalance,
    inputBalanceRaw,
    outputBalanceRaw,
    isBalanceLoading,
    balancesLoaded,
    resetBalances,
    refreshBalances,
  } = useParaSpellBalances({
    isConnected,
    walletAddress,
    inputToken,
    outputToken,
    determineCurrency,
    getTAssetFromKey,
  });

  // Handle wallet disconnect - account management is now handled by the wallet dialog
  const handleDisconnect = useCallback(() => {
    // Wallet disconnect cleanup
  }, []);

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
    skipPriceFetch: false, // 🔥 TEMPORARY: Skip price fetch for testing swap signing
    // Pass helpers from useXcmTokens
    getOptimalExchanges,
    determineCurrency,
    getTAssetFromKey,
  })

  // Unified swap flow state management
  const {
    flowState,
    startConfirmation,
    confirmSwap,
    cancelSwap,
    startExecution,
    updateExecution,
    completeSwap,
    failSwap,
    reset: resetSwapFlow,
    isConfirming,
    isExecuting,
    isSuccess,
    isActive
  } = useSwapFlow();

  // XCM Swap execution hook with ParaSpell RouterBuilder
  const { executeSwap } = useXcmSwapExecution({
    inputToken,
    outputToken,
    inputAmount,
    outputAmount,
    slippageTolerance,
    walletAddress,
    polkadotSigner,
    getOptimalExchanges,
    determineCurrency,
    getTAssetFromKey,
    onExecutionStart: startExecution,
    onExecutionUpdate: updateExecution,
    onSuccess: (success) => {
      completeSwap(success);
      // Don't auto-reset - let SwapCompleteDialog control its own lifecycle
      // Dialog will call resetSwapFlow (via onClose) when user dismisses it
      // This allows user to interact with gift animation without being rushed
      setInputAmount('');
      resetRoute();
      resetBalances(true);
    },
    onError: (error) => {
      failSwap(error);
      // Auto-reset after showing error state
      setTimeout(() => {
        setInputAmount('');
        resetRoute();
        resetSwapFlow();
      }, 5000);
    }
  });

  // Handle swap button click - show confirmation sheet
  const handleSwapClick = useCallback(() => {
    // Create simulation result from current route data
    const simulationResult = {
      success: true,
      estimatedFee: estimatedFees || '0',
      feeBreakdown: feeBreakdown as any, // Type cast to match SimulationResult interface
      willSucceed: !routeState.error,
      error: routeState.error || undefined
    };
    startConfirmation(simulationResult);
  }, [estimatedFees, feeBreakdown, routeState.error, startConfirmation]);

  // Handle confirm swap - user confirmed in sheet
  const handleConfirmSwap = useCallback(() => {
    confirmSwap(); // Transitions to 'awaiting_signature'
    executeSwap(); // Starts execution
  }, [confirmSwap, executeSwap]);

  // Handle cancel swap - user cancelled
  const handleCancelSwap = useCallback(() => {
    cancelSwap(); // Resets to 'idle'
  }, [cancelSwap]);

  // Handle wallet disconnect with confirmation state cleanup
  const handleWalletDisconnect = useCallback(() => {
    handleDisconnect();
    if (isActive) {
      resetSwapFlow();
    }
    // Reset route state
    resetRoute();
    // Reset input amount
    setInputAmount('');
  }, [handleDisconnect, isActive, resetSwapFlow, resetRoute]);

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

      // Check for insufficient balance
      if (value && inputBalance && parseFloat(value) > parseFloat(inputBalance)) {
        setInsufficientBalance(true);
      } else {
        setInsufficientBalance(false);
      }
    }
  }, [debouncedFetchRoute, resetRoute, inputBalance]);

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
                onPercentageSelect={(value) => {
                  const balanceNum = parseFloat(inputBalance || '0');
                  const calculatedAmount = (balanceNum * value).toString();
                  handleInputChange(calculatedAmount);
                }}
                isLoading={isBalanceLoading}
                balancesLoaded={balancesLoaded}
                isConnected={isConnected}
                onConnectWalletClick={() => setIsConnectWalletOpen(true)}
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
                isLoading={isLoadingQuote}
                balancesLoaded={balancesLoaded}
                isConnected={isConnected}
                isProcessing={isLoadingQuote}
                error={routeState.error}
                onConnectWalletClick={() => setIsConnectWalletOpen(true)}
                onSelectRecipientClick={() => setIsSelectRecipientOpen(true)}

              />
            </div>

            <SwapDetails
              minimumReceived={calculateMinimumReceived(outputAmount, slippageTolerance)}
              outputToken={outputToken}
              inputToken={inputToken}
              maxTransactionFee={estimatedFees || flowState.simulationResult?.estimatedFee || '0'}
              feeBreakdown={feeBreakdown || flowState.simulationResult?.feeBreakdown}
              route={routeDex || ''}
              isLoading={routeState.isLoading}
              isProcessing={isProcessing}
              isLoadingQuote={isLoadingQuote}
              isLoadingFees={isLoadingFees}
            />

            <SubmitButtonAction
              isConnected={isConnected}
              isSwapping={isActive}
              onSwap={handleSwapClick}
              insufficientBalance={insufficientBalance}
              disabled={!inputAmount || inputAmount === '' || parseFloat(inputAmount) <= 0 || insufficientBalance}
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
        isOpen={isConfirming}
        onClose={handleCancelSwap}
        onConfirm={handleConfirmSwap}
        inputAmount={inputAmount}
        inputToken={inputToken?.symbol || ''}
        outputAmount={outputAmount}
        outputToken={outputToken?.symbol || ''}
        slippageTolerance={slippageTolerance}
        simulationResult={flowState.simulationResult || null}
        isConfirming={false}
      />

      <SwapCompleteDialog 
        isOpen={isExecuting || isSuccess}
        isSwappingInProgress={isExecuting}
        isSwapComplete={isSuccess}
        inputAmount={inputAmount}
        inputToken={inputToken?.symbol || ''}
        outputAmount={outputAmount}
        outputToken={outputToken?.name || ''}
        duration={flowState.success?.duration || 4000}
        onClose={resetSwapFlow}
        currentStep={flowState.execution?.currentStep}
        totalSteps={flowState.execution?.totalSteps}
        currentTransactionType={flowState.execution?.transactionType}
      />

      <ConnectWalletDialog isOpen={isConnectWalletOpen} onOpenChange={setIsConnectWalletOpen} />
      <SelectRecipientDialog 
        isOpen={isSelectRecipientOpen} 
        onConnectWalletClick={() => setIsConnectWalletOpen(true)}
        onOpenChange={setIsSelectRecipientOpen} 
      />
    </>
  )
} 