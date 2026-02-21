import { create } from 'zustand';
import type { Airline } from '@airtr/core';
import { loadAirline, publishAirline, getUserPubkey, setupSigner, connectNDK } from '@airtr/nostr';
import { fp } from '@airtr/core';

export interface AirlineState {
    airline: Airline | null;
    isLoading: boolean;
    error: string | null;
    isKeyConfigured: boolean;

    // Actions
    initializeIdentity: () => Promise<void>;
    createAirline: (params: Omit<Airline, 'pubkey' | 'brandScore' | 'balance' | 'tier'>) => Promise<void>;
}

export const useAirlineStore = create<AirlineState>((set, get) => ({
    airline: null,
    isLoading: true, // start loading to check keys immediately
    error: null,
    isKeyConfigured: false,

    initializeIdentity: async () => {
        set({ isLoading: true, error: null });
        try {
            await connectNDK();
            const hasNip07 = await setupSigner();
            set({ isKeyConfigured: true });

            const pubkey = await getUserPubkey();
            if (pubkey) {
                const existing = await loadAirline(pubkey);
                if (existing) {
                    set({ airline: existing, isLoading: false });
                    return;
                }
            }
            set({ isLoading: false, airline: null });
        } catch (error: any) {
            set({ error: error.message, isLoading: false, airline: null });
        }
    },

    createAirline: async (params) => {
        set({ isLoading: true, error: null });
        try {
            await publishAirline(params);

            const pubkey = await getUserPubkey();
            if (!pubkey) throw new Error("Could not retrieve pubkey after publishing");

            const newAirline: Airline = {
                pubkey,
                ...params,
                brandScore: 0.5,
                balance: fp(100000000), // starting balance
                tier: 1,
            };

            set({ airline: newAirline, isLoading: false });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    }
}));
