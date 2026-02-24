import { create } from 'zustand';
import { AirlineState } from './types.js';
import { createIdentitySlice } from './slices/identitySlice.js';
import { createFleetSlice } from './slices/fleetSlice.js';
import { createNetworkSlice } from './slices/networkSlice.js';
import { createEngineSlice } from './slices/engineSlice.js';
import { useEngineStore } from './engine.js';

export * from './types.js';

/**
 * AIRLINE STORE
 * 
 * The main store for the player's airline.
 * Refactored into specialized slices for easier maintenance.
 */
export const useAirlineStore = create<AirlineState>()((...a) => ({
    ...createIdentitySlice(...a),
    ...createFleetSlice(...a),
    ...createNetworkSlice(...a),
    ...createEngineSlice(...a),
}));

// --- Side Effects ---

// Automatically process fleet ticks when engine ticks advance
useEngineStore.subscribe((state) => {
    useAirlineStore.getState().processTick(state.tick);
});
