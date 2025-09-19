import { supabase } from '@/lib/supabase';
import type { Database } from '@/services/db/supabase';

export type SwapHistory = Database['public']['Tables']['swap_history']['Row'];
export type SwapHistoryInsert = Database['public']['Tables']['swap_history']['Insert'];
export type SwapHistoryUpdate = Database['public']['Tables']['swap_history']['Update'];

//TODO: fix the supabase type error
export class SwapHistoryService {
  /**
   * Records a new swap in the history
   */
  static async recordSwap(
    walletAddress: string,
    fromAsset: string,
    toAsset: string,
    amount: number,
    routeUsed: string,
    status: 'success' | 'failed' = 'success',
    chainFrom?: string,
    chainTo?: string
  ): Promise<SwapHistory> {
    try {
      const { data, error } = await (supabase as any)
        .from('swap_history')
        .insert({
          user_wallet: walletAddress,
          from_asset: fromAsset,
          to_asset: toAsset,
          amount,
          chain_from: chainFrom,
          chain_to: chainTo,
          route_used: routeUsed,
          status
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to record swap');

      return data;
    } catch (error) {
      console.error('Error in recordSwap:', error);
      throw error;
    }
  }

  /**
   * Gets swap history for a wallet address
   */
  static async getSwapHistoryByWalletAddress(walletAddress: string): Promise<SwapHistory[]> {
    try {
      const { data, error } = await supabase
        .from('swap_history')
        .select('*')
        .eq('user_wallet', walletAddress)
        .order('timestamp', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error in getSwapHistoryByWalletAddress:', error);
      throw error;
    }
  }

  /**
   * Updates the status of a swap
   */
  static async updateSwapStatus(
    swapId: string,
    status: 'success' | 'failed'
  ): Promise<SwapHistory> {
    try {
      const { data, error } = await (supabase as any)
        .from('swap_history')
        .update({ status })
        .eq('id', swapId)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update swap status');

      return data;
    } catch (error) {
      console.error('Error in updateSwapStatus:', error);
      throw error;
    }
  }
} 