import { supabase } from '@/lib/supabase';
import type { Database } from '@/services/db/supabase';

export type User = Database['public']['Tables']['users']['Row'];
export type UserInsert = Database['public']['Tables']['users']['Insert'];
export type UserUpdate = Database['public']['Tables']['users']['Update'];

export class UserService {
  /**
   * Creates a new user or updates an existing user's data
   */
  static async createOrUpdateUser(walletAddress: string): Promise<User> {
    try {
      // Check if user exists
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select()
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (existingUser) {
        return existingUser;
      }

      // Create new user
      const { data: newUser, error: insertError } = await (supabase as any)
        .from('users')
        .insert([{
          wallet_address: walletAddress,
          current_rank: 'Initiate',
          xp: 0
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      if (!newUser) throw new Error('Failed to create user');

      return newUser;
    } catch (error) {
      console.error('Error in createOrUpdateUser:', error);
      throw error;
    }
  }

  /**
   * Updates a user's XP and rank
   */
  static async updateUserXP(walletAddress: string, xpToAdd: number): Promise<User> {
    try {
      // First get current XP
      const { data: user, error: fetchError } = await (supabase as any)
        .from('users')
        .select()
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError) throw fetchError;
      if (!user) throw new Error('User not found');

      // Calculate new XP and determine rank
      const newXP = user.xp + xpToAdd;
      const newRank = this.calculateRank(newXP);

      // Update user
      const { data: updatedUser, error: updateError } = await (supabase as any)
        .from('users')
        .update({
          xp: newXP,
          current_rank: newRank
        })
        .eq('wallet_address', walletAddress)
        .select()
        .single();

      if (updateError) throw updateError;
      if (!updatedUser) throw new Error('Failed to update user');

      return updatedUser;
    } catch (error) {
      console.error('Error in updateUserXP:', error);
      throw error;
    }
  }

  /**
   * Gets user data by wallet address
   */
  static async getUserByWalletAddress(walletAddress: string): Promise<User | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select()
        .eq('wallet_address', walletAddress)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // No data found
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserByWalletAddress:', error);
      throw error;
    }
  }

  /**
   * Calculate user rank based on XP
   */
  private static calculateRank(xp: number): string {
    if (xp >= 10000) return 'Master';
    if (xp >= 5000) return 'Expert';
    if (xp >= 2000) return 'Advanced';
    if (xp >= 500) return 'Intermediate';
    return 'Initiate';
  }
} 