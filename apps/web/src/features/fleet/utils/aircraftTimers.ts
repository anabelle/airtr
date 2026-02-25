import { TICK_DURATION, type AircraftInstance } from '@airtr/core';

export type AircraftTimerKind = 'enroute' | 'turnaround' | 'maintenance' | 'delivery';

export interface AircraftTimer {
    label: string;
    time: string;
    kind: AircraftTimerKind;
    isImminent: boolean;
    targetTick: number;
    totalTicks: number;
    progress: number;
}

export function formatCountdown(totalSeconds: number) {
    const normalizedSeconds = Math.max(0, Math.round(totalSeconds));
    if (normalizedSeconds >= 3600) {
        const hours = Math.floor(normalizedSeconds / 3600);
        const minutes = Math.floor((normalizedSeconds % 3600) / 60);
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    const minutes = Math.floor(normalizedSeconds / 60);
    const seconds = normalizedSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getAircraftTimer(
    aircraft: AircraftInstance,
    tick: number,
    tickProgress: number
): AircraftTimer | null {
    let targetTick: number | undefined;
    let startTick: number | undefined;
    let label = '';
    let kind: AircraftTimerKind | null = null;

    if (aircraft.status === 'delivery') {
        startTick = aircraft.purchasedAtTick;
        targetTick = aircraft.deliveryAtTick;
        label = 'Delivery';
        kind = 'delivery';
    }

    if (aircraft.status === 'enroute') {
        startTick = aircraft.flight?.departureTick;
        targetTick = aircraft.flight?.arrivalTick;
        const destination = aircraft.flight?.destinationIata;
        const isFerry = aircraft.flight?.purpose === 'ferry';
        const prefix = isFerry ? 'Ferry ETA' : 'Inbound';
        label = destination ? `${prefix} ${destination}` : prefix;
        kind = 'enroute';
    }

    if (aircraft.status === 'turnaround') {
        startTick = aircraft.arrivalTickProcessed;
        targetTick = aircraft.turnaroundEndTick;
        label = 'Quick turn';
        kind = 'turnaround';
    }

    if (aircraft.status === 'maintenance') {
        startTick = aircraft.maintenanceStartTick ?? aircraft.arrivalTickProcessed;
        targetTick = aircraft.turnaroundEndTick;
        label = 'Tech release';
        kind = 'maintenance';
    }

    if (!kind || targetTick === undefined) return null;

    const baseStartTick = startTick ?? targetTick;
    const totalTicks = Math.max(1, targetTick - baseStartTick);

    const remainingTicks = targetTick - tick - tickProgress;
    const remainingSeconds = Math.max(
        0,
        Math.ceil(remainingTicks * (TICK_DURATION / 1000))
    );
    const progressRaw = 1 - (remainingTicks / totalTicks);
    const progress = Math.min(1, Math.max(0, progressRaw));

    return {
        label,
        time: formatCountdown(remainingSeconds),
        kind,
        isImminent: remainingSeconds > 0 && remainingSeconds <= 300,
        targetTick,
        totalTicks,
        progress,
    };
}
