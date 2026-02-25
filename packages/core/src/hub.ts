import type { HubState } from './types.js';
import type { Route } from './types.js';

export function buildHubState(hubIata: string, routes: Route[]): HubState {
    let weeklyFrequency = 0;
    let spokeCount = 0;

    for (const route of routes) {
        if (route.originIata !== hubIata) continue;
        spokeCount += 1;
        weeklyFrequency += route.frequencyPerWeek ?? 0;
    }

    return {
        hubIata,
        spokeCount,
        weeklyFrequency,
        avgFrequency: spokeCount > 0 ? weeklyFrequency / spokeCount : 0,
    };
}
