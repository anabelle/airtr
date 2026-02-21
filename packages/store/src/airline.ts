import { create } from 'zustand';
import type { Airline } from '@airtr/core';
import { fp } from '@airtr/core';
import {
    hasNip07,
    getPubkey,
    attachSigner,
    ensureConnected,
    loadAirline,
    publishAirline,
} from '@airtr/nostr';

/**
 * User paths:
 * 
 * 1. No NIP-07 extension → show "Install Extension" message, can't play
 * 2. Extension present, first visit → getPubkey() → no airline found → show Create form
 * 3. Extension present, return visit → getPubkey() → load airline → show dashboard
 * 4. Extension present, switch identity → reload → getPubkey() returns NEW pubkey → load THAT airline
 * 
 * Key invariant: we ALWAYS ask window.nostr.getPublicKey() fresh on each init.
 * We never cache the pubkey ourselves. The extension is the source of truth.
 */

export type IdentityStatus = 'checking' | 'no-extension' | 'ready';

export interface AirlineState {
    airline: Airline | null;
    pubkey: string | null;
    identityStatus: IdentityStatus;
    isLoading: boolean;
    error: string | null;

    // Actions
    initializeIdentity: () => Promise<void>;
    createAirline: (params: Omit<Airline, 'pubkey' | 'brandScore' | 'balance' | 'tier'>) => Promise<void>;
}

export const useAirlineStore = create<AirlineState>((set) => ({
    airline: null,
    pubkey: null,
    identityStatus: 'checking',
    isLoading: false,
    error: null,

    initializeIdentity: async () => {
        // Step 1: Check for NIP-07 extension
        if (!hasNip07()) {
            set({ identityStatus: 'no-extension', isLoading: false });
            return;
        }

        set({ isLoading: true, error: null, airline: null, pubkey: null });

        try {
            // Step 2: Get pubkey from extension (fresh every time — no caching)
            const pubkey = await getPubkey();

            if (!pubkey) {
                set({ identityStatus: 'no-extension', isLoading: false, error: 'Extension did not return a pubkey' });
                return;
            }

            // Step 3: Attach signer to NDK (fresh instance to avoid cached identity)
            attachSigner();

            // Step 4: Start relay connections (fire-and-forget, NDK handles reconnection)
            ensureConnected();

            // Step 5: Try to load existing airline for this pubkey
            const existing = await loadAirline(pubkey);

            set({
                pubkey,
                airline: existing,
                identityStatus: 'ready',
                isLoading: false,
            });
        } catch (error: any) {
            set({
                error: error.message,
                identityStatus: 'ready', // Extension works, just failed to load
                isLoading: false,
            });
        }
    },

    createAirline: async (params) => {
        set({ isLoading: true, error: null });
        try {
            // Ensure signer is attached and relays connected
            attachSigner();
            ensureConnected();

            await publishAirline(params);

            // Get current pubkey (should already be known)
            const pubkey = await getPubkey();
            if (!pubkey) throw new Error('Lost identity during publish');

            const newAirline: Airline = {
                pubkey,
                ...params,
                brandScore: 0.5,
                balance: fp(100000000),
                tier: 1,
            };

            set({ airline: newAirline, pubkey, isLoading: false });
        } catch (error: any) {
            set({ error: error.message, isLoading: false });
        }
    },
}));
