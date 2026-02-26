import type { AirlineEntity } from '@airtr/core';

export type AirlineConflictResult = {
    nameConflict: string | null;
    icaoConflict: string | null;
};

export function findAirlineConflicts(
    competitors: Map<string, AirlineEntity>,
    name: string,
    icaoCode: string,
): AirlineConflictResult {
    const normalizedName = name.trim().toLowerCase();
    const normalizedIcao = icaoCode.trim().toLowerCase();

    let nameConflict: string | null = null;
    let icaoConflict: string | null = null;

    if (!normalizedName && !normalizedIcao) {
        return { nameConflict, icaoConflict };
    }

    for (const competitor of competitors.values()) {
        if (!nameConflict && normalizedName) {
            if (competitor.name.trim().toLowerCase() === normalizedName) {
                nameConflict = competitor.name;
            }
        }

        if (!icaoConflict && normalizedIcao) {
            if (competitor.icaoCode.trim().toLowerCase() === normalizedIcao) {
                icaoConflict = competitor.icaoCode;
            }
        }

        if (nameConflict && icaoConflict) break;
    }

    return { nameConflict, icaoConflict };
}
