import { StateCreator } from 'zustand';
import { AirlineState } from '../types';
import { processFlightEngine } from '../FlightEngine';
import { publishAirline } from '@airtr/nostr';

export interface EngineSlice {
    processTick: (tick: number) => Promise<void>;
}

let isProcessing = false;

export const createEngineSlice: StateCreator<
    AirlineState,
    [],
    [],
    EngineSlice
> = (set, get) => ({
    processTick: async (tick: number) => {
        if (isProcessing) return;

        const { fleet, airline, routes } = get();
        if (!airline) return;

        // 1. Determine where we are vs where we need to be
        const lastTick = airline.lastTick ?? (tick - 1);

        // If we are already caught up, skip.
        if (lastTick >= tick) return;

        isProcessing = true;
        try {
            // 2. Catch up simulation
            // We loop from the last processed tick to the current one.
            // Safety cap: Never simulate more than 50,000 ticks (~40 hours) in one frame 
            // to avoid freezing the browser. Players returning after a week will catch up 
            // in chunks as the clock moves.
            const MAX_CATCHUP = 50000;
            const startTick = Math.max(lastTick, tick - MAX_CATCHUP);

            let currentFleet = [...fleet];
            let currentBalance = airline.corporateBalance;
            let anyChanges = false;

            for (let t = startTick + 1; t <= tick; t++) {
                const result = processFlightEngine(
                    t,
                    currentFleet,
                    routes,
                    currentBalance
                );
                currentFleet = result.updatedFleet;
                currentBalance = result.corporateBalance;
                if (result.hasChanges) anyChanges = true;
            }

            // 3. Update state
            const updatedAirline = { ...airline, corporateBalance: currentBalance, lastTick: tick };
            set({ fleet: currentFleet, airline: updatedAirline });

            // 4. Sync to Nostr only if significant events happened
            if (anyChanges) {
                publishAirline({
                    ...updatedAirline,
                    fleet: currentFleet,
                    routes
                }).catch(e => console.error("Auto-sync tick failed", e));
            }
        } finally {
            isProcessing = false;
        }
    },
});
