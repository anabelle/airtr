import { describe, expect, it } from 'vitest';
import { formatCountdown, getAircraftTimer } from './aircraftTimers';
import { fp } from '@airtr/core';
import type { AircraftInstance } from '@airtr/core';

const makeAircraft = (overrides: Partial<AircraftInstance> = {}): AircraftInstance => ({
    id: 'ac-1',
    ownerPubkey: 'pubkey-1',
    modelId: 'a320neo',
    name: 'Ship 1',
    status: 'idle',
    assignedRouteId: null,
    baseAirportIata: 'JFK',
    purchasedAtTick: 0,
    purchasePrice: fp(100000000),
    birthTick: 0,
    purchaseType: 'buy',
    configuration: { economy: 156, business: 24, first: 0, cargoKg: 3700 },
    flightHoursTotal: 0,
    flightHoursSinceCheck: 0,
    condition: 1,
    flight: null,
    ...overrides,
});

describe('aircraftTimers', () => {
    it('formats countdowns under one hour as mm:ss', () => {
        expect(formatCountdown(0)).toBe('0:00');
        expect(formatCountdown(65)).toBe('1:05');
        expect(formatCountdown(3599)).toBe('59:59');
    });

    it('formats countdowns over one hour as h:mm', () => {
        expect(formatCountdown(3600)).toBe('1:00');
        expect(formatCountdown(3661)).toBe('1:01');
        expect(formatCountdown(7322)).toBe('2:02');
    });

    it('builds enroute timer label and remaining time', () => {
        const aircraft = makeAircraft({
            status: 'enroute',
            flight: {
                originIata: 'JFK',
                destinationIata: 'LAX',
                departureTick: 10,
                arrivalTick: 15,
                direction: 'outbound',
            },
        });

        const timer = getAircraftTimer(aircraft, 12, 0.5);
        expect(timer?.kind).toBe('enroute');
        expect(timer?.label).toBe('Inbound LAX');
        expect(timer?.time).toBe('0:08');
        expect(timer?.isImminent).toBe(true);
        expect(timer?.totalTicks).toBe(5);
        expect(timer?.progress).toBeCloseTo(0.5, 2);
    });

    it('builds maintenance timer label', () => {
        const aircraft = makeAircraft({
            status: 'maintenance',
            turnaroundEndTick: 120,
            maintenanceStartTick: 100,
        });

        const timer = getAircraftTimer(aircraft, 110, 0);
        expect(timer?.kind).toBe('maintenance');
        expect(timer?.label).toBe('Tech release');
        expect(timer?.totalTicks).toBe(20);
        expect(timer?.progress).toBeCloseTo(0.5, 2);
    });

    it('builds turnaround timer label', () => {
        const aircraft = makeAircraft({
            status: 'turnaround',
            turnaroundEndTick: 80,
        });

        const timer = getAircraftTimer(aircraft, 70, 0);
        expect(timer?.kind).toBe('turnaround');
        expect(timer?.label).toBe('Quick turn');
    });

    it('builds delivery timer label', () => {
        const aircraft = makeAircraft({
            status: 'delivery',
            baseAirportIata: 'LAX',
            purchasedAtTick: 10,
            deliveryAtTick: 20,
        });

        const timer = getAircraftTimer(aircraft, 12, 0.5);
        expect(timer?.kind).toBe('delivery');
        expect(timer?.label).toBe('Delivery LAX');
    });

    it('returns null when no timer target exists', () => {
        const aircraft = makeAircraft({ status: 'enroute', flight: null });
        const timer = getAircraftTimer(aircraft, 10, 0);
        expect(timer).toBeNull();
    });
});
